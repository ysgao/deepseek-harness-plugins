/**
 * The File view: an ordinary `conversation.view` tab (alongside Chat and
 * Trajectory) rendering the shared `FilePreview` body for the session's
 * latest opened path (a `viewRequest` with `view: 'file'` — see
 * `ConvViewOwnerProps`). Populated only through the `conversationFileOpener`
 * service; the tab itself renders a resting notice while no path has ever
 * been opened, mirroring the empty-state posture of a fresh Chat view
 * rather than hiding itself. Mounted only when this package is installed,
 * like every other `conversation.view` entry.
 *
 * A text-kind file (`isTextKind` — all plain text on disk, whatever their
 * View-mode body renders) with a pending git change (per `getGitStatus`)
 * offers a View/Diff toggle; Diff mode fetches `getFileDiff` lazily and
 * renders `SideBySideDiff` in place of the plain preview. Binary, image, PDF,
 * and Office (`.docx`/`.xlsx`/`.xls`/`.pptx`) files stay out of scope for the
 * toggle — a text-only diff over their rendered content, rather than their raw
 * bytes, is a deferred follow-up, not a gap.
 *
 * Every text kind (`isTextKind`) also offers an Edit mode (`FileEditor`) over
 * the file's raw text, passed the same `langFromPath` grammar hint the View
 * mode's `FilePreview` reads. Whatever a kind's read-only body is — syntax
 * highlighting, rendered Markdown, a detected ontology serialization, a
 * `.csv`'s table, an `.rtf`'s extracted text — the editor shows that same body
 * live in its preview pane, beside the plain editing buffer.
 * Unsaved edits live in an in-memory per-path draft cache (`draftsRef`), not
 * React state, so switching to another file (or to View/Diff) and back
 * never silently loses a draft — no native `beforeunload`/`confirm` dialog
 * needed. Saving goes through `writeFile`'s version guard; a concurrent
 * on-disk change surfaces as an inline conflict notice rather than
 * overwriting it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { FileEditor, FilePreview, isContentMismatch, isTextKind, SideBySideDiff } from 'dsh-plugins-client-ui-file-editing'
import type {
  FileEditorResizeLabels, FilePreviewLabels, FilePreviewState, SideBySideDiffLabels,
} from 'dsh-plugins-client-ui-file-editing'
import type { WorkspaceFileContent, WorkspaceFileVersion } from 'dsh-plugins-api-workspace-file-controller/types'
import type { WorkspaceFileDiff } from 'dsh-plugins-api-workspace-file-controller/types'
import type { WorkspaceGitStatus } from 'dsh-plugins-api-workspace-git-controller/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
// The seat this tab declares (./document-seat.ts) is filled by
// dsh-plugins-client-ui-document-host when that package is composed in; this
// tab draws its own preview when it is not.
import type { FileDocumentHookContext } from './document-seat.ts'
import type { SidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { langFromPath, viewerKindFor } from './classify.ts'
import css from './FileView.module.css'

/**
 * Injected share of the File view entry. Every method takes the opened
 * path's own `workspaceId` (from the opener's request, when it had one —
 * see `OpenFileFocus`) rather than resolving it from the session, so a
 * request from a requester that already knows its exact workspace (the
 * Workspace Files tree) can never be misrouted to the wrong one.
 */
export interface FileViewInjected {
  /** Read one file's content under the given Workspace (fails when neither `workspaceId` nor a session-derived fallback resolves one). */
  readFile: (workspaceId: WorkspaceId | undefined, path: string, signal?: AbortSignal) => Promise<WorkspaceFileContent>
  /** Open the file with the Host OS default application (the external-kind and error fallback). */
  openPath: (path: string) => Promise<void>
  /** The given Workspace's git branch and pending file changes (decides whether the Diff toggle shows). */
  getGitStatus: (workspaceId: WorkspaceId | undefined, signal?: AbortSignal) => Promise<WorkspaceGitStatus>
  /** One file's `HEAD` and working-tree text, fetched lazily when the user switches to Diff mode. */
  getFileDiff: (workspaceId: WorkspaceId | undefined, path: string, signal?: AbortSignal) => Promise<WorkspaceFileDiff>
  /** Overwrite one file's content under the given Workspace, guarded by `expectedVersion`. */
  writeFile: (
    workspaceId: WorkspaceId | undefined, path: string, content: string, expectedVersion: WorkspaceFileVersion, signal?: AbortSignal,
  ) => Promise<WorkspaceFileVersion>
  /**
   * Compose the `dsh-resource://file/session/<id>/<path>` address for a path
   * this tab has open, in this tab's own session.
   *
   * That address is the identity every document renderer reads its file
   * through (`useResource`, the paged read, the byte read), so the tab has
   * to speak it to host one. Built in the entry's `inject`, where the
   * session id lives, rather than derived from props here.
   */
  fileAddress: (path: string) => string
  /** Bound `conversation-files` locale translate function (this package's own namespace — see `../ARCHITECTURE.md`). */
  tFiles: TranslateNS<'conversation-files'>
}

/**
 * The File view's own opaque `viewRequest.focus` payload (see
 * `ConvViewOwnerProps`'s JSDoc): JSON-encoded by the `conversationFileOpener`
 * provider so a requester's own `workspaceId`, when it has one, survives
 * the hand-off through the generic view-request channel.
 */
interface OpenFileFocus {
  readonly path: string
  readonly workspaceId?: WorkspaceId
}

/** Which body the tab shows for the opened path: the plain preview, the in-app editor, or the git diff. */
type FileViewMode = 'view' | 'edit' | 'diff'

/**
 * Page operations a document body binds while it is mounted (its own reload,
 * chiefly). Read off the actions contract rather than imported by name: the
 * command set is the Sidebar's to grow, and this tab only has to hold
 * whatever it is handed.
 */
type DocumentCommands = Parameters<SidebarRightTabInfo['tab']['actions']['bindCommands']>[0]

/** Fetch state for the currently diffed path. */
type DiffFetchState =
  | { phase: 'loading' }
  | { phase: 'ready'; diff: WorkspaceFileDiff }
  | { phase: 'error' }

/** An in-progress edit for one path, forked from the version it was last read/saved at. */
interface FileDraft {
  text: string
  version: WorkspaceFileVersion
}

/** Save-button/status state for the currently open path's Edit mode. */
type SaveState =
  | { phase: 'idle' }
  | { phase: 'saving' }
  | { phase: 'conflict' }
  | { phase: 'error' }

/** Full File-view component props: runtime & injected & the pristine `conversation`-namespace locale seat. */
export type FileViewProps =
  & ConvViewProps
  & InjectFace<FileViewInjected>
  & PropsLocale<'conversation'>
  & PropsRenderSlots<'conversation.file.document'>

/**
 * Parse the File view's own opaque `focus` payload — a JSON-encoded
 * {@link OpenFileFocus} written by the `conversationFileOpener` provider.
 * Never expected to fail within one coordinated deploy of both packages;
 * guarded rather than left to throw across a serialization boundary.
 * @param focus - the raw `viewRequest.focus` string.
 * @returns the decoded path/workspaceId pair, or null if it doesn't parse.
 */
function parseOpenFileFocus(focus: string): OpenFileFocus | null {
  try {
    const parsed: unknown = JSON.parse(focus)
    if (typeof parsed !== 'object' || parsed === null || !('path' in parsed) || typeof parsed.path !== 'string') return null
    return parsed as OpenFileFocus
  } catch {
    return null
  }
}

/**
 * Draft-cache/effect/remount identity for one opened path. `path` alone
 * conflates two different Workspace groups that happen to share a relative
 * path (e.g. each has its own root `README.md`) into one draft cache entry
 * and one `FileEditor` mount: opening one workspace's file, then the other's
 * same-named file into this same tab, would otherwise show/edit/save the
 * first workspace's draft under the second's identity. `workspaceId` is
 * optional (a requester that never resolved one), so it is joined with a
 * separator rather than merely concatenated, keeping `(undefined, "a:b")`
 * distinct from `("a", "b")`.
 * @param workspaceId - the opened path's own workspace, when known.
 * @param path - the opened path.
 * @returns a string key unique per `(workspaceId, path)` pair.
 */
function fileIdentityOf(workspaceId: WorkspaceId | undefined, path: string): string {
  return `${workspaceId ?? ''}:${path}`
}

/** Basename of a path, both separators accepted. */
function basename(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1) || path
}

/**
 * Decode base64 wire bytes to a revocable blob URL, for the `image` kind's
 * inline `<img>`. Named via a `File` (not a bare `Blob`) so a right-click
 * "Save Image As" (or any other consumer of the URL that looks past its own
 * opaque `blob:...` path) offers the file's real name.
 */
function decodeBlobUrl(base64: string, mediaType: string, path: string): string {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return URL.createObjectURL(new File([bytes], basename(path), { type: mediaType }))
}

/** Decode base64 wire bytes to a raw `ArrayBuffer`, for `FilePreview`'s own in-browser PDF/Office parsers (no blob URL needed). */
function decodeBytes(base64: string): ArrayBuffer {
  const binary = atob(base64)
  return Uint8Array.from(binary, char => char.charCodeAt(0)).buffer
}

/**
 * Resolve one readFile rejection into the state its cause distinguishes.
 * Discriminates by `code`, never `instanceof` — {@link remoteErrorOf}'s own
 * contract, since a RemoteError rebuilt on this Client face is not the same
 * class instance the Host threw.
 */
function stateFromError(error: unknown): FilePreviewState {
  const failure = remoteErrorOf(error)
  if (failure?.code === 'workspace-files/file-too-large') return { phase: 'too-large', maxBytes: failure.details.maxBytes }
  return { phase: 'error' }
}

/**
 * Render the File view tab.
 * @param props - see {@link FileViewProps}.
 * @returns the tab's body element.
 */
export function FileView({
  viewRequest, completeViewRequest, readFile, openPath, getGitStatus, getFileDiff, writeFile, fileAddress,
  renderSlot, tFiles, t,
}: FileViewProps) {
  const filePreviewLabels: FilePreviewLabels = useMemo(() => ({
    markdown: { code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('markdown.footnotes') },
    read: {
      // ReadBlockLabels extends CodeToolbarLabels as of vendor pin 477b4f42;
      // these three are the toolbar's own copy, from the shared namespace the
      // rest of this block already reads.
      codeLabel: t('codeBlock.title'),
      wrapLabel: t('codeBlock.wrap'),
      unwrapLabel: t('codeBlock.unwrap'),
      window: (shown, total) => t('read.window', { shown, total }),
      copy: t('copy'),
      copied: t('copied'),
      collapseAria: t('read.collapseAria'),
      expandAria: count => t('read.expandAria', { count }),
      collapse: t('collapse'),
      expand: count => t('read.expandRest', { count }),
    },
    delimited: {
      truncated: (rows, cols) => tFiles('files.viewer.delimitedTruncated', { rows, cols }),
      empty: tFiles('files.viewer.delimitedEmpty'),
    },
    rtf: {
      truncated: (shown, total) => tFiles('files.viewer.rtfTruncated', { shown, total }),
      empty: tFiles('files.viewer.rtfEmpty'),
    },
  }), [t, tFiles])

  const editorResizeLabels: FileEditorResizeLabels = useMemo(() => ({
    ariaLabel: tFiles('files.edit.resizeAria'),
    title: tFiles('files.edit.resizeTitle'),
  }), [tFiles])

  const diffLabels: SideBySideDiffLabels = useMemo(() => ({
    copy: t('copy'),
    copied: t('copied'),
    resizeAria: tFiles('files.diff.resizeAria'),
    resizeTitle: tFiles('files.diff.resizeTitle'),
  }), [t, tFiles])

  const openFileFocus = viewRequest?.view === 'file' ? parseOpenFileFocus(viewRequest.focus) : null
  const [openedPath, setOpenedPath] = useState<string | null>(null)
  const [openedWorkspaceId, setOpenedWorkspaceId] = useState<WorkspaceId | undefined>(undefined)
  const [state, setState] = useState<FilePreviewState>({ phase: 'loading' })
  const [version, setVersion] = useState<WorkspaceFileVersion | null>(null)
  const [mode, setMode] = useState<FileViewMode>('view')
  const [changed, setChanged] = useState(false)
  const [diffState, setDiffState] = useState<DiffFetchState>({ phase: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)
  const [refreshToken, setRefreshToken] = useState(0)

  // Unsaved edits, keyed by `fileIdentityOf(workspaceId, path)` (not `path`
  // alone — two different workspaces can share a relative path), so
  // switching to another file (or to View/Diff) and back never silently
  // loses a draft, and never shows one workspace's draft under another's
  // identity. Plain mutable state (not React state): every keystroke would
  // otherwise re-render the whole tab. `hasDraft` is the reactive slice
  // callers actually need to render from (the unsaved-changes indicator,
  // whether Save is enabled).
  const draftsRef = useRef(new Map<string, FileDraft>())
  const [hasDraft, setHasDraft] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>({ phase: 'idle' })

  // A one-shot handoff (viewRequest/completeViewRequest): acknowledge
  // immediately so a second open of the same path (a re-click while already
  // showing it) still notifies through the opener's seq-keyed request.
  useEffect(() => {
    if (openFileFocus === null) return
    setOpenedPath(openFileFocus.path)
    setOpenedWorkspaceId(openFileFocus.workspaceId)
    completeViewRequest()
  }, [openFileFocus, completeViewRequest])

  const kind = openedPath === null ? 'external' : viewerKindFor(openedPath)
  // See `fileIdentityOf`'s own doc comment: `path` alone conflates two
  // different workspaces' same-named files into one draft/editor identity.
  const openedFileId = openedPath === null ? null : fileIdentityOf(openedWorkspaceId, openedPath)

  // One lifetime per opened file, handed to a document body as the signal
  // its own reads ride on. Aborting it on change is what stops the previous
  // file's paged read from landing in the new file's body.
  const documentLifetimeRef = useRef<AbortController | null>(null)
  const [documentLifetime, setDocumentLifetime] = useState<AbortController | null>(null)
  useEffect(() => {
    if (openedFileId === null) return
    const controller = new AbortController()
    documentLifetimeRef.current = controller
    setDocumentLifetime(controller)
    return () => { controller.abort() }
  }, [openedFileId])
  // Counted, not derived from the path: a second open of the SAME file (a
  // re-click in the tree) is still a navigation, and a body that acts on
  // "navigated again" — scrolling to a line, reloading — must see it.
  const [navigationRevision, setNavigationRevision] = useState(1)
  useEffect(() => { setNavigationRevision(value => value + 1) }, [openedFileId])
  // A document body binds its page operations here (its own reload, chiefly)
  // for as long as it is mounted. Held in a ref, not state: binding is not a
  // reason to re-render the tab around it.
  const documentCommandsRef = useRef<DocumentCommands | null>(null)

  // What a relocated document body is told about the tab it is drawn in.
  // Every field is settled from this tab's own state; see
  // `dsh-plugins-client-ui-document-host`'s `contract.ts` for why a body can
  // be answered this way at all.
  const documentContext = useMemo<FileDocumentHookContext | null>(() => {
    if (openedPath === null || openedFileId === null || documentLifetime === null) return null
    const address = fileAddress(openedPath)
    return {
      tab: { id: `conversation-file:${openedFileId}` as TabId, kind: 'text', contentId: address, title: basename(openedPath) },
      // No params: the File tab is opened with a path, never yet with a line.
      // A body reads `revision` alone to know it was navigated to again.
      navigation: { address, params: undefined, revision: navigationRevision },
      // The seat is only rendered in View mode, and View mode is only
      // rendered while this tab is the conversation's selected view.
      visible: true,
      signal: documentLifetime.signal,
      actions: {
        bindCommands: (commands) => {
          documentCommandsRef.current = commands
          return () => {
            // Never clear a newer body's binding: an unmounting body's
            // disposer can run after its replacement has already bound.
            if (documentCommandsRef.current === commands) documentCommandsRef.current = null
          }
        },
        openResource: (next) => {
          const file = parseFileAddress(next)
          // A body following a link inside a document (an HTML href, a
          // Markdown relative link) stays in this tab, which is where the
          // reader is looking. An address this tab cannot show — another
          // session's file, a non-file resource — is declined rather than
          // silently opening somewhere else.
          if (file?.scope === 'session') setOpenedPath(file.path)
        },
        // Page types are a right-Sidebar concept: there are no pages to open
        // in a File tab, and a body asking for one gets nothing rather than
        // an exception thrown through the renderer.
        openTab: () => {},
        close: () => { setOpenedPath(null) },
      },
      // The refresh keybinding belongs to the right Sidebar's page chrome;
      // this tab has its own controls, so a body that labels a refresh
      // shortcut simply finds none.
      shortcuts: [],
    }
  }, [openedPath, openedFileId, documentLifetime, navigationRevision, fileAddress])

  // A newly opened (path, workspaceId) pair always starts in plain-view mode
  // with a clean save state — deliberately keyed on `openedFileId`, not
  // `refreshToken`: a post-save refresh (below) must re-fetch git status
  // without kicking the tab back to View or clobbering the just-cleared
  // save/draft state.
  useEffect(() => {
    setMode('view')
    setSaveState({ phase: 'idle' })
    setHasDraft(openedFileId !== null && draftsRef.current.has(openedFileId))
  }, [openedFileId])

  // Whether the Diff toggle even shows depends on this fetch, one shot per
  // open (not a live subscription — the tree's own explicit-refresh control
  // is the precedent for keeping this in step with a background repo
  // change). `refreshToken` re-runs the same fetch once after a successful
  // save, so the toggle reflects the just-written content.
  useEffect(() => {
    setChanged(false)
    if (openedPath === null) return
    const controller = new AbortController()
    getGitStatus(openedWorkspaceId, controller.signal).then((status) => {
      if (controller.signal.aborted) return
      setChanged(Object.hasOwn(status.files, openedPath))
    }).catch(() => {
      // Git status here is an affordance signal, not required content: a
      // failure (e.g. the session has no owning workspace) just keeps the
      // Diff toggle hidden rather than surfacing an error.
    })
    return () => { controller.abort() }
  }, [openedPath, openedWorkspaceId, getGitStatus, refreshToken])

  // The diff itself is fetched lazily, only once the user switches into
  // Diff mode — not on every plain-view open. `refreshToken` re-runs it once
  // after a save while already in Diff mode.
  useEffect(() => {
    if (mode !== 'diff' || openedPath === null) return
    setDiffState({ phase: 'loading' })
    const controller = new AbortController()
    getFileDiff(openedWorkspaceId, openedPath, controller.signal).then((diff) => {
      if (controller.signal.aborted) return
      setDiffState({ phase: 'ready', diff })
    }).catch(() => {
      if (controller.signal.aborted) return
      setDiffState({ phase: 'error' })
    })
    return () => { controller.abort() }
  }, [mode, openedPath, openedWorkspaceId, getFileDiff, refreshToken])

  useEffect(() => {
    if (openedPath === null) return
    setState({ phase: 'loading' })
    setVersion(null)
    // External-viewer files (unrecognized extensions, or a legacy binary
    // .doc/.ppt with no client-side parser) never fetch content at all: the
    // tab's only action is the OS handoff.
    const openedKind = viewerKindFor(openedPath)
    if (openedKind === 'external') return
    const controller = new AbortController()
    let createdUrl: string | null = null
    readFile(openedWorkspaceId, openedPath, controller.signal).then((content) => {
      if (controller.signal.aborted) return
      if (content.kind === 'text') {
        setState({ phase: 'ready', content: { kind: 'text', text: content.content } })
        setVersion(content.version)
        return
      }
      if (openedKind === 'image') {
        createdUrl = decodeBlobUrl(content.data, content.mediaType, openedPath)
        setState({ phase: 'ready', content: { kind: 'binary', blobUrl: createdUrl } })
      } else if (openedKind === 'pdf' || openedKind === 'docx' || openedKind === 'xlsx' || openedKind === 'pptx') {
        setState({ phase: 'ready', content: { kind: 'bytes', data: decodeBytes(content.data) } })
      } else {
        setState({ phase: 'ready', content: { kind: 'binary', blobUrl: null } })
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setState(stateFromError(error))
    })
    return () => {
      controller.abort()
      if (createdUrl !== null) URL.revokeObjectURL(createdUrl)
    }
  }, [openedPath, openedWorkspaceId, readFile, reloadToken])

  // Records every keystroke into the current (path, workspaceId)'s draft,
  // forked from the version the buffer was seeded at (the read's version, or
  // the prior draft's — never re-derived per keystroke, only at fork time).
  const handleEditChange = useCallback((text: string) => {
    if (openedFileId === null) return
    const baseVersion = draftsRef.current.get(openedFileId)?.version ?? version
    if (baseVersion === null) return
    draftsRef.current.set(openedFileId, { text, version: baseVersion })
    setHasDraft(true)
  }, [openedFileId, version])

  const handleSave = useCallback(() => {
    if (openedPath === null || openedFileId === null) return
    const draft = draftsRef.current.get(openedFileId)
    if (draft === undefined) return
    setSaveState({ phase: 'saving' })
    writeFile(openedWorkspaceId, openedPath, draft.text, draft.version).then((nextVersion) => {
      draftsRef.current.delete(openedFileId)
      setHasDraft(false)
      setSaveState({ phase: 'idle' })
      setVersion(nextVersion)
      setState({ phase: 'ready', content: { kind: 'text', text: draft.text } })
      setRefreshToken(token => token + 1)
    }).catch((error: unknown) => {
      const conflict = remoteErrorOf(error)?.code === 'workspace-files/file-changed'
      setSaveState({ phase: conflict ? 'conflict' : 'error' })
    })
  }, [openedPath, openedFileId, openedWorkspaceId, writeFile])

  // Discards the current draft and re-fetches the path fresh — the
  // conflict notice's recovery action, since a version mismatch means the
  // draft's base is no longer valid to save over.
  const handleDiscardAndReload = useCallback(() => {
    if (openedFileId === null) return
    draftsRef.current.delete(openedFileId)
    setHasDraft(false)
    setSaveState({ phase: 'idle' })
    setMode('view')
    setReloadToken(token => token + 1)
  }, [openedFileId])

  if (openedPath === null) {
    return <div className={css.empty}>{tFiles('files.empty')}</div>
  }

  // A ready read whose content disagrees with what the classified kind
  // expects (a mismatched extension) offers the same external-open fallback
  // as too-large/error/genuinely-external — mirrors FileViewer's
  // showsExternalOnly (dsh-plugins-client-ui-workspace-files's own
  // Modal-based viewer).
  const showsExternalOnly = kind === 'external' || state.phase === 'error' || state.phase === 'too-large' || isContentMismatch(kind, state)

  // Every text kind edits and diffs the same way, whatever its View-mode body
  // makes of that text: one CodeMirror buffer over the file's raw text, and
  // `SideBySideDiff`'s two-column diff of that same text.
  const textKind = isTextKind(kind) ? kind : null
  const readyText = state.phase === 'ready' && state.content.kind === 'text' ? state.content.text : null
  const showsEditToggle = textKind !== null && readyText !== null
  const showsDiffToggle = textKind !== null && changed
  const sameText = diffState.phase === 'ready' && diffState.diff.oldText === diffState.diff.newText
  const draft = openedFileId === null ? undefined : draftsRef.current.get(openedFileId)
  const editorText = draft?.text ?? readyText ?? ''

  // This tab's own preview: what View mode has always drawn, and what it
  // still draws whenever the document seat is empty — `dsh-plugins-client-ui-
  // document-host` not composed in, or composed in and declining this file.
  const ownPreview = (
    <FilePreview
      className={css.body}
      path={openedPath}
      kind={kind}
      state={state}
      lang={langFromPath(openedPath)}
      labels={filePreviewLabels}
      loadingLabel={tFiles('files.viewer.loading')}
      loadErrorLabel={tFiles('files.viewer.loadError')}
      externalLabel={tFiles('files.viewer.openExternally')}
      tooLargeLabel={maxMB => tFiles('files.viewer.tooLarge', { maxMB })}
      xlsxTruncatedLabel={(rows, cols) => tFiles('files.viewer.xlsxTruncated', { rows, cols })}
      xlsxEmptyLabel={tFiles('files.viewer.xlsxEmpty')}
      pptxSlideLabel={index => tFiles('files.viewer.pptxSlide', { index })}
      pptxEmptyLabel={tFiles('files.viewer.pptxEmpty')}
    />
  )

  return (
    <div className={css.root}>
      <div className={css.header}>
        <span className={css.path}>
          {openedPath}
          {hasDraft && <span className={css.unsaved} aria-hidden> •</span>}
        </span>
        <div className={css.headerActions}>
          {mode === 'edit' && (
            <>
              {saveState.phase === 'conflict' && (
                <span className={css.conflict} role="alert">
                  {tFiles('files.edit.conflict')}
                  {' '}
                  <button type="button" className={css.conflictReload} onClick={handleDiscardAndReload}>
                    {tFiles('files.edit.reload')}
                  </button>
                </span>
              )}
              {saveState.phase === 'error' && <span className={css.conflict} role="alert">{tFiles('files.edit.saveError')}</span>}
              <Button variant="primary" disabled={!hasDraft || saveState.phase === 'saving'} onClick={handleSave}>
                {saveState.phase === 'saving' ? tFiles('files.edit.saving') : tFiles('files.edit.save')}
              </Button>
            </>
          )}
          {(showsDiffToggle || showsEditToggle) && (
            <div className={css.modeToggle}>
              <Button variant={mode === 'view' ? 'primary' : 'ghost'} onClick={() => { setMode('view') }}>
                {tFiles('files.diff.view')}
              </Button>
              {showsEditToggle && (
                <Button variant={mode === 'edit' ? 'primary' : 'ghost'} onClick={() => { setMode('edit') }}>
                  {tFiles('files.edit.edit')}
                </Button>
              )}
              {showsDiffToggle && (
                <Button variant={mode === 'diff' ? 'primary' : 'ghost'} onClick={() => { setMode('diff') }}>
                  {tFiles('files.diff.diff')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      {mode === 'diff' && (
        <div className={css.body}>
          {diffState.phase === 'loading' && <p className={css.diffNotice}>{tFiles('files.viewer.loading')}</p>}
          {diffState.phase === 'error' && <p className={css.diffNotice} role="alert">{tFiles('files.viewer.loadError')}</p>}
          {diffState.phase === 'ready' && (
            sameText
              ? <p className={css.diffNotice}>{tFiles('files.diff.empty')}</p>
              : (
                <SideBySideDiff
                  path={openedPath}
                  oldText={diffState.diff.oldText}
                  newText={diffState.diff.newText}
                  labels={diffLabels}
                />
              )
          )}
        </div>
      )}
      {mode === 'edit' && showsEditToggle && textKind !== null && (
        <FileEditor
          key={openedFileId}
          path={openedPath}
          text={editorText}
          kind={textKind}
          lang={langFromPath(openedPath)}
          labels={filePreviewLabels}
          resizeLabels={editorResizeLabels}
          onChange={handleEditChange}
          onSaveRequested={handleSave}
          className={css.body}
        />
      )}
      {mode === 'view' && (
        documentContext === null
          ? ownPreview
          : renderSlot('conversation.file.document', {}, { hookContext: documentContext, fallback: ownPreview })
      )}
      {mode === 'view' && showsExternalOnly && (
        <div className={css.footer}>
          <Button variant="outline" onClick={() => { void openPath(openedPath) }}>
            {tFiles('files.viewer.openExternally')}
          </Button>
        </div>
      )}
    </div>
  )
}
