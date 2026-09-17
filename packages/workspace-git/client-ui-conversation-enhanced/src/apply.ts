/**
 * Fork of `dsh-client-ui-conversation`'s own `apply.ts` — registers the
 * same target-neutral Conversation assembly, shell, input, and docks, plus
 * the `conversationFileOpener` optional service (`./service.ts`) that lets
 * the sidebar Files tree dock a file into the current session's File tab,
 * even before that session's first turn.
 * `dsh-plugins-bundle-workspace-git`'s `cordis.patch.yml` disables the
 * original `ui-conversation` row and installs this one in its place — see
 * `../../../../ARCHITECTURE.md`'s "Replace, don't patch".
 *
 * Every registration here is unchanged from the pristine `apply()` except
 * `registerConversationRoot`, `registerConversationSession`, and
 * `registerConversationHeader`: each `inject()` factory gains an
 * `everOpenedFile` hook (the `FileOpenRegistry`'s sticky per-session "has a
 * file ever been opened here" bit), `registerConversationSession` also
 * gains a `pendingFileOpen` hook and `completePendingFileOpen` callback, and
 * all three register this package's own forked components
 * (`./ConversationRoot.tsx`, `./ConversationSession.tsx`) instead of the
 * pristine ones — their blank/Hero gate needs to stay open once
 * `everOpenedFile` is true, so a file opened before a session's first turn
 * doesn't land in a hidden view. The pristine package's own top-level
 * `main`-slot wrapper registration (`ConversationPanel`, mounting
 * `main.conversation` beneath the shared `main` root occupant) and
 * `InputBar`'s `conversation.composer.bar` registration are both reused
 * verbatim — `InputBar` unchanged from `@deepseek-ai/dsh-client-ui-
 * conversation`'s own `./src/*` export, `ConversationPanel` likewise.
 *
 * Resilience (see `../../../../ARCHITECTURE.md`'s "Plugin isolation"):
 * every `ctx.slots.register()` call below registers at `priority: -1`, one
 * lower than the pristine plugin's own default (0) — if a bundle
 * install-order violation ever leaves the pristine `ui-conversation` row
 * active too, both registrations land instead of the second one throwing,
 * and this one wins deterministically (lowest priority renders). `apply()`
 * itself falls back to the pristine, unmodified `apply(ctx)` if enhanced
 * setup fails *before* any registration has been attempted — safe because
 * nothing of this plugin's has registered yet at that point. That fallback
 * is a dynamic `import()`, not a static top-level one: statically importing
 * vendor's `apply.ts` would unconditionally evaluate (and CSS-inject)
 * vendor's whole Conversation component tree on every load, including the
 * overwhelmingly common path where the fallback never fires — see
 * `styleInjectionModule` in `tsdown.client-plugin-preset.ts` for the CSS
 * injection tag-identity collision that caused with this package's own
 * `ConversationRoot.module.css`. (This package's own forked skeleton files
 * import that CSS Module cross-package now, not as a local copy — see
 * `./ConversationMainPanel.tsx`'s own doc comment for why — so this
 * specific collision risk no longer applies to them, but the dynamic-import
 * discipline remains correct practice for the same reason it always was:
 * avoiding unconditional evaluation of vendor's whole component tree.)
 *
 * Once past that point each individual slot registration
 * (`settings.general.item`, the `main`-slot wrapper, and each of the four
 * Conversation-assembly registrations) is independently try/catch-guarded
 * instead: a failure there degrades only that one row, rather than either
 * crashing the whole app or falling back to a full pristine replay that
 * would double-register whatever already succeeded.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { IconPaperclipOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { createSnapshotStore, type BoundActions, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only service and declaration merges used by this assembly. Pristine
// apply.ts gets the SlotMap['main']/['main.conversation'] merge (declared in
// ui-layout, not ui-conversation) for free from a sibling file in that
// package's own compiled program; this package's program doesn't include
// that sibling, so the import is explicit here (see ../client-ui-workspace-
// enhanced's own README for the same "type-only imports don't pull in
// transitively" finding).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/src/client/conversation/assembly.ts'
import type { ViewTab } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/views.ts'
import type {
  ComposerBarInjected, ConversationInjected, ConversationSessionHeaderInjected,
  ConversationSessionInjected, DraftFileUploads,
} from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/slots.ts'
import type { InputNotice } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/input.ts'
import { createConversationStore } from '@deepseek-ai/dsh-client-ui-conversation/src/client/stores.ts'
import {
  ConversationController, UnsupportedImageMediaTypeError,
} from '@deepseek-ai/dsh-client-ui-conversation/src/client/service.ts'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/src/client/service.ts'
import { ComposerBlockRegistry } from '@deepseek-ai/dsh-client-ui-conversation/src/client/input/blocks.ts'
import type { ComposerBlock } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/composer-blocks.ts'
import { InputHub } from '@deepseek-ai/dsh-client-ui-conversation/src/client/input/hub.ts'
import { ComposerSubmissionPolicy } from '@deepseek-ai/dsh-client-ui-conversation/src/client/input/submission-policy.ts'
import { queueDockEntry } from '@deepseek-ai/dsh-client-ui-conversation/src/client/queue/QueueDock.tsx'
import { EnterBehaviorRow } from '@deepseek-ai/dsh-client-ui-conversation/src/client/settings/EnterBehaviorRow.tsx'
import type {
  EnterBehaviorRowInjected,
} from '@deepseek-ai/dsh-client-ui-conversation/src/client/settings/EnterBehaviorRow.tsx'
import { ConversationPanel } from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationPanel.tsx'
import { InputBar } from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/InputBar.tsx'
import { todoDockEntry } from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/TodoPanel.tsx'
import { resolveActiveView } from '@deepseek-ai/dsh-client-ui-conversation/src/client/view-selection.ts'
import { en, NS, zh, type ConversationKey } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import {
  CONVERSATION_SETTINGS_NAMESPACE, type ConversationSettings,
} from '@deepseek-ai/dsh-client-ui-conversation/src/submission-settings.ts'
import { ConversationRoot } from './ConversationRoot.tsx'
import { ConversationSession, ConversationSessionHeader } from './ConversationSession.tsx'
import { FileOpenRegistry, type PendingFileOpen } from './FileOpenRegistry.ts'
import type { ConversationFileOpener } from './service.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Conversation shell, composer, queue, and dock copy. */
    conversation: ConversationKey
  }
}

/** Services required by the Conversation plugin. */
export const inject = [
  'slots', 'sessions', 'fileUpload', 'uiSession', 'uiWorkspace', 'locale', 'settingsScope',
]

/** Conversation runtime configuration, mirrored from the replaced plugin so a
 * `maxConcurrentFileUploads` set against `ui-conversation` keeps working when
 * this fork stands in for it. */
export interface Config {
  /** Maximum generic-file uploads allowed to run concurrently in browser Workers. */
  maxConcurrentFileUploads?: number
}

/** Validated Conversation runtime configuration. */
export const Config: z<Config> = z.object({
  maxConcurrentFileUploads: z.natural().min(1).default(2),
})

// Stable no-session sources keep the renderer's observable-hook cache and
// hook order unchanged across current-Session transitions.
const ABSENT_NOTICES = {
  getSnapshot: (): InputNotice | null => null,
  subscribe: () => () => {},
}
const ABSENT_BLOCK = {
  getSnapshot: (): ComposerBlock | undefined => undefined,
  subscribe: () => () => {},
}
const EMPTY_LEXICON: ReadonlyMap<'/' | '@', readonly string[]> = new Map()
const ABSENT_LEXICON = {
  getSnapshot: () => EMPTY_LEXICON,
  subscribe: () => () => {},
}
const ABSENT_MENU_LAUNCHER = {
  getSnapshot: (): string | null => null,
  subscribe: () => () => {},
}
const EMPTY_FILE_UPLOADS: DraftFileUploads = {}
const ABSENT_FILE_UPLOADS = {
  getSnapshot: () => EMPTY_FILE_UPLOADS,
  subscribe: () => () => {},
}
// No-session root render: never true for a real session (FileOpenRegistry
// only ever answers true for a sessionId that has actually requested an
// open), so a stable constant is correct, not just convenient.
const ABSENT_EVER_OPENED = {
  getSnapshot: (): boolean => false,
  subscribe: () => () => {},
}

interface WorkspaceNavigation {
  openSession(sessionId: SessionId): void
  openWorkspace(
    workspaceId: Parameters<ConversationInjected['selectWorkspace']>[0],
    beforeOpen: (sessionId: SessionId) => void,
  ): Promise<void>
}

/** Action registration used by the composer without importing its command-UI consumer. */
interface FileCommandRegistry {
  register(contribution: {
    name: string
    label(): string
    icon: typeof IconPaperclipOutline16
    available(session: { sessionId: SessionId }): boolean
    ui: { kind: 'action'; run(session: { sessionId: SessionId }): void }
  }): () => void
}

/** Business callbacks injected into the resident Conversation shell, widened with the sticky ever-opened-a-file bit. */
export interface EnhancedConversationInjected extends ConversationInjected {
  readonly hooks: ConversationInjected['hooks'] & {
    /** Whether this session (absent without one) has ever opened a file — see `FileOpenRegistry`. */
    readonly everOpenedFile: ObservableSnapshot<boolean>
  }
}

/** Business callbacks injected into the strict Session body, widened with the file-open drain and the sticky ever-opened-a-file bit. */
export interface EnhancedConversationSessionInjected extends ConversationSessionInjected {
  readonly hooks: ConversationSessionInjected['hooks'] & {
    /** This Session's own pending `conversationFileOpener` request, if any. */
    readonly pendingFileOpen: ObservableSnapshot<PendingFileOpen | undefined>
    /** Whether this session has ever opened a file — see `FileOpenRegistry`. */
    readonly everOpenedFile: ObservableSnapshot<boolean>
  }
  /** Acknowledge the current pending file-open request (one-shot, mirrors `completeViewRequest`). */
  completePendingFileOpen: () => void
}

/** Business callbacks injected into the strict Session header, widened with the sticky ever-opened-a-file bit. */
export interface EnhancedConversationSessionHeaderInjected extends ConversationSessionHeaderInjected {
  readonly hooks: ConversationSessionHeaderInjected['hooks'] & {
    /** Whether this session has ever opened a file — see `FileOpenRegistry`. */
    readonly everOpenedFile: ObservableSnapshot<boolean>
  }
}

/** Resolve the session-scoped Conversation action face, failing loud. */
function scopedConversation(sessions: ISessions, id: SessionId): IConversation {
  const scoped = sessions.scope(id)
  if (scoped === undefined) throw new Error(`ui-conversation: session "${id}" resolved no scope`)
  const conversation = scoped.get('conversation')
  if (conversation === undefined) {
    throw new Error('ui-conversation: conversation service unavailable through the session scope')
  }
  return conversation
}

/** Resolve package-internal attachment operations from the public service. */
function concreteConversation(ctx: Context): ConversationController {
  const conversation = ctx.get('conversation') as ConversationController | undefined
  if (conversation === undefined) throw new Error('ui-conversation: conversation service unavailable')
  return conversation
}

/**
 * Mount the Conversation core and target-neutral presentation.
 * @param ctx - Client root context.
 */
export async function apply(ctx: Context, config: Config = Config({})): Promise<void> {
  const sessions = ctx.sessions
  const slots = ctx.slots
  // Schemastery's field default is materialized before Cordis calls apply.
  const maxConcurrentFileUploads = config.maxConcurrentFileUploads as number
  let workspaceNavigation: WorkspaceNavigation
  let uiConversation: UiConversation
  let fileOpenRegistry: FileOpenRegistry
  try {
    workspaceNavigation = ctx.get('uiWorkspace') as unknown as WorkspaceNavigation
    uiConversation = new UiConversation(ctx, sessions)
    fileOpenRegistry = new FileOpenRegistry()
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-conversation: dictionaries')
  } catch (error) {
    // Nothing of this plugin's has registered yet at this point, so a full
    // pristine replay is safe — see this file's own doc comment.
    ctx.logger.error(
      'dsh-plugins-client-ui-conversation-enhanced: enhanced setup failed — falling back to the pristine dsh-client-ui-conversation plugin',
    )
    ctx.logger.error(error)
    // Dynamic, not static — see this file's own doc comment.
    const { apply: pristineApply } = await import('@deepseek-ai/dsh-client-ui-conversation/src/client/apply.ts')
    pristineApply(ctx, config)
    return
  }
  const t = ctx.locale.bind(NS)
  const conversationStore = createConversationStore()
  const submissionPolicy = new ComposerSubmissionPolicy(
    ctx.settingsScope.bind<ConversationSettings>({ namespace: CONVERSATION_SETTINGS_NAMESPACE }),
  )

  ctx.slots.inject('settings.general.item', () => {
    try {
      return ctx.slots.register({
        name: 'settings.general.item',
        id: 'composer-enter',
        priority: -1,
        order: 20,
        locale: NS,
        inject: (): EnterBehaviorRowInjected => ({
          hooks: { busyEnter: submissionPolicy.busyEnter },
          setBusyEnter: (behavior) => { submissionPolicy.setBusyEnter(behavior) },
        }),
      }, EnterBehaviorRow)
    } catch (error) {
      ctx.logger.error('dsh-plugins-client-ui-conversation-enhanced: failed to register the composer-enter settings item')
      ctx.logger.error(error)
      return []
    }
  })

  const viewTabs = (): ViewTab[] => {
    const tabs: ViewTab[] = []
    for (const entry of slots.entries('conversation.view')) {
      /* v8 ignore next -- list registration validates id at load. */
      if (entry.options.id === undefined) continue
      tabs.push({
        id: entry.options.id,
        label: resolveSlotLabel(entry.options.label) ?? entry.options.id,
      })
    }
    return tabs
  }
  const activateView = (sessionId: SessionId, preferred: string | null): void => {
    const active = resolveActiveView(viewTabs(), preferred)
    if (active !== undefined) uiConversation.binding(sessionId).activate(active.id)
  }
  // Pristine `dsh-client-ui-conversation` seeds this from the Session's own
  // persisted View preference (`readConversationViewPreference`). This fork
  // deliberately ignores that preference and activates the landing View
  // (`null` -> `resolveActiveView`'s Chat default) instead, because every
  // mount of a Session's subtree now lands on Chat regardless of what was
  // persisted — see `./DefaultConversationViews.tsx`'s own landing effect
  // for why (the File view cannot restore what it was showing). Activation
  // is monotonic per Session, so a View the user then selects by hand
  // (`selectView`/`openView` below) still activates on its own.
  const activateLandingView = (sessionId: SessionId): void => {
    activateView(sessionId, null)
  }
  const activateCurrentLandingView = (): void => {
    const sessionId = sessions.list.getSnapshot().current
    if (sessionId !== undefined && sessions.binding(sessionId) !== undefined) {
      activateLandingView(sessionId)
    }
  }
  const conversationViews = createSnapshotStore<readonly ViewTab[]>(viewTabs())
  const refreshViews = (): void => {
    const current = conversationViews.getSnapshot()
    const next = viewTabs()
    const unchanged = current.length === next.length
      && current.every((tab, index) => {
        const candidate = next.at(index)
        return candidate !== undefined && tab.id === candidate.id && tab.label === candidate.label
      })
    if (!unchanged) conversationViews.set(next)
    activateCurrentLandingView()
  }
  ctx.effect(() => {
    let currentSessionId = sessions.list.getSnapshot().current
    const disposeViews = slots.subscribe('conversation.view', refreshViews)
    const disposeLocale = ctx.locale.subscribe(refreshViews)
    const disposeCurrent = sessions.list.subscribe(() => {
      const nextSessionId = sessions.list.getSnapshot().current
      if (nextSessionId === currentSessionId) return
      currentSessionId = nextSessionId
      activateCurrentLandingView()
    })
    return () => {
      disposeCurrent()
      disposeLocale()
      disposeViews()
    }
  }, 'ui-conversation: View selection')

  // FileOpenRegistry's pending/everOpened/hook Maps and Sets are keyed by
  // SessionId and never pruned on their own (see FileOpenRegistry.forget's
  // own doc comment) — release a session's entries once it drops out of the
  // Host-authoritative list, mirroring vendor's own
  // `ComposerBlockRegistry.forget` contract.
  ctx.effect(() => {
    let knownIds = new Set(sessions.list.getSnapshot().ids)
    return sessions.list.subscribe(() => {
      const nextIds = new Set(sessions.list.getSnapshot().ids)
      for (const id of knownIds) {
        if (!nextIds.has(id)) fileOpenRegistry.forget(id)
      }
      knownIds = nextIds
    })
  }, 'ui-conversation: FileOpenRegistry pruning')

  const inputHub = new InputHub(ctx, t)
  const composerBlocks = new ComposerBlockRegistry()

  ctx.inject(['commandUi'], (scope) => {
    const commands = scope.get('commandUi') as FileCommandRegistry
    scope.effect(() => commands.register({
      name: 'file',
      label: () => t('input.file'),
      icon: IconPaperclipOutline16,
      available: session => inputHub.canPickFiles(session.sessionId),
      ui: { kind: 'action', run: (session) => { inputHub.pickFiles(session.sessionId) } },
    }), 'ui-conversation: File action')
  })

  // Conversation assembly and input share the Session binding lifecycle. The
  // source roster is installed before any consuming Slot entry.
  ctx.uiSession.provide({
    hooks: ['conversation', 'input'],
    props: ['inputActions'],
    resolve: (binding) => {
      const shell = inputHub.shellFor(binding)
      const conversation = uiConversation.binding(binding)
      activateLandingView(binding.sessionId)
      return {
        hooks: {
          conversation: conversation.snapshot,
          input: shell.state,
        },
        props: { inputActions: shell.actions },
      }
    },
  })

  const registerConversationRoot = () => slots.register({
    name: 'main.conversation',
    priority: -1,
    locale: NS,
    children: {
      'conversation.session': { kind: 'single', scope: 'session' },
      'conversation.session.header': { kind: 'single', scope: 'session' },
      'conversation.composer': { kind: 'chain', scope: 'session' },
      'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
      'conversation.hero.workspace': { kind: 'single', scope: 'root' },
      'conversation.hero.agentPreset': { kind: 'single', scope: 'root' },
    },
    inject: (sessionId: SessionId | undefined): EnhancedConversationInjected => ({
      hooks: {
        composerBlock: sessionId === undefined ? ABSENT_BLOCK : composerBlocks.storeFor(sessionId),
        everOpenedFile: sessionId === undefined ? ABSENT_EVER_OPENED : fileOpenRegistry.hookForEverOpened(sessionId),
      },
      selectWorkspace: workspaceId => workspaceNavigation.openWorkspace(workspaceId, (nextId) => {
        if (sessionId !== undefined && nextId !== sessionId) {
          const from = inputHub.shell(sessionId)
          const draft = from.snapshot.draft
          const attachmentIds = from.snapshot.attachmentIds
          const next = inputHub.shell(nextId)
          if (attachmentIds.length === 0 || next.addAttachments(attachmentIds)) {
            if (sessions.binding(nextId) === undefined) {
              throw new Error(`ui-conversation: session "${nextId}" resolved no binding`)
            }
            concreteConversation(ctx).rebindDraftFiles(nextId, attachmentIds)
            if (draft !== '') {
              next.setDraft(draft)
              from.setDraft('')
            }
            if (attachmentIds.length > 0) {
              for (const id of attachmentIds) from.removeAttachment(id)
            }
          }
        }
      }),
    }),
  }, ConversationRoot)

  const registerConversationSession = () => slots.register({
    name: 'conversation.session',
    priority: -1,
    children: {
      'conversation.view': { kind: 'list', scope: 'session' },
    },
    store: conversationStore,
    inject: (
      sessionId: SessionId, actions: BoundActions<typeof conversationStore>,
    ): EnhancedConversationSessionInjected => ({
      hooks: {
        conversationViews,
        pendingFileOpen: fileOpenRegistry.hookFor(sessionId),
        everOpenedFile: fileOpenRegistry.hookForEverOpened(sessionId),
      },
      bindDraftMirror: write => inputHub.shell(sessionId).bindMirror(write),
      openView: (view, focus) => {
        activateView(sessionId, view)
        actions.openView(view, focus)
      },
      completePendingFileOpen: () => { fileOpenRegistry.complete(sessionId) },
    }),
  }, ConversationSession)

  const registerConversationHeader = () => slots.register({
    name: 'conversation.session.header',
    priority: -1,
    locale: NS,
    children: {
      'conversation.session.header.lineage': { kind: 'single', scope: 'session' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      'conversation.session.header.corner': { kind: 'single', scope: 'session' },
    },
    store: conversationStore,
    inject: (
      sessionId: SessionId, actions: BoundActions<typeof conversationStore>,
    ): EnhancedConversationSessionHeaderInjected => ({
      hooks: { conversationViews, everOpenedFile: fileOpenRegistry.hookForEverOpened(sessionId) },
      open: (id) => { workspaceNavigation.openSession(id) },
      selectView: (view) => {
        activateView(sessionId, view)
        actions.setView(view)
      },
    }),
  }, ConversationSessionHeader)

  const registerComposerBar = () => slots.register({
    name: 'conversation.composer.bar',
    priority: -1,
    locale: NS,
    children: {
      'conversation.input.attachments': { kind: 'single', scope: 'session-maybe' },
      'conversation.input.overlay': { kind: 'list', scope: 'session' },
      'conversation.input.permission': { kind: 'single', scope: 'session' },
      'conversation.input.left': { kind: 'list', scope: 'session' },
      'conversation.input.plan': { kind: 'single', scope: 'session' },
      'conversation.input.right': { kind: 'list', scope: 'session' },
      'conversation.input.model': { kind: 'single', scope: 'session' },
      'conversation.composer.dock': { kind: 'list', scope: 'session' },
    },
    inject: (sessionId: SessionId | undefined): ComposerBarInjected => {
      if (sessionId === undefined) {
        return {
          keyboard: undefined,
          addFiles: undefined,
          removeAttachment: undefined,
          resolveDraftAttachments: undefined,
          retryFileUpload: undefined,
          toggleCommandMenu: undefined,
          stop: undefined,
          hooks: {
            busyEnter: submissionPolicy.busyEnter,
            fileUploads: ABSENT_FILE_UPLOADS,
            notices: ABSENT_NOTICES,
            lexicon: ABSENT_LEXICON,
            menuLauncher: ABSENT_MENU_LAUNCHER,
          },
        }
      }
      const conversation = concreteConversation(ctx)
      const shell = inputHub.shell(sessionId)
      const inputTriggers = inputHub.inputTriggers(sessionId)
      return {
        keyboard: shell,
        addFiles: (files) => {
          if (sessions.binding(sessionId) === undefined) return t('file.sessionUnavailable')
          try {
            const drafts = conversation.createDrafts(sessionId, files)
            if (!shell.addAttachments(drafts.map(draft => draft.id))) {
              conversation.releaseDraftAttachments(drafts)
            }
            return null
          } catch (error: unknown) {
            if (error instanceof UnsupportedImageMediaTypeError) return t('image.unsupportedType')
            return error instanceof Error ? error.message : String(error)
          }
        },
        removeAttachment: (id) => {
          if (shell.removeAttachment(id)) conversation.releaseDraftAttachment(id)
        },
        resolveDraftAttachments: ids => conversation.resolveDraftAttachments(ids),
        retryFileUpload: (id) => {
          if (sessions.binding(sessionId) !== undefined) conversation.retryFileUpload(sessionId, id)
        },
        toggleCommandMenu: inputTriggers === undefined
          ? undefined
          : (selection) => {
            shell.dismissPopup()
            const snapshot = shell.snapshot
            inputTriggers.toggleSource('command', {
              trigger: '/',
              query: '',
              quoted: false,
              position: snapshot.draft.slice(0, selection.start).trim() === '' ? 'leading' : 'inline',
              span: { ...selection, draftRev: snapshot.draftRev },
            })
          },
        stop: () => {
          scopedConversation(sessions, sessionId).cancel().catch(() => {
            // Stop failure is published through Session promptError.
          })
        },
        hooks: {
          busyEnter: submissionPolicy.busyEnter,
          fileUploads: conversation.fileUploads,
          notices: shell.notices,
          lexicon: shell.lexicon,
          menuLauncher: inputTriggers?.launcher ?? ABSENT_MENU_LAUNCHER,
        },
      }
    },
  }, InputBar)

  slots.inject('main', function* () {
    const attempts: ReadonlyArray<{ readonly label: string; readonly register: () => () => void }> = [
      {
        label: 'main',
        register: () => slots.register({
          name: 'main',
          key: 'conversation',
          priority: -1,
          children: { 'main.conversation': { kind: 'single', scope: 'session-maybe' } },
        }, ConversationPanel),
      },
      { label: 'main.conversation', register: registerConversationRoot },
      { label: 'conversation.session', register: registerConversationSession },
      { label: 'conversation.session.header', register: registerConversationHeader },
      { label: 'conversation.composer.bar', register: registerComposerBar },
    ]
    // Each registration is independently guarded: the 'main' row declares
    // main.conversation, registerConversationRoot declares the child slots
    // the other three register into, so if either fails the ones depending
    // on it would fail too (their target slots never existed) — catching
    // each individually still means every failure here logs and is skipped,
    // never propagates out of this generator to crash the whole Client boot.
    for (const { label, register } of attempts) {
      try {
        yield register()
      } catch (error) {
        ctx.logger.error(`dsh-plugins-client-ui-conversation-enhanced: failed to register ${label}`)
        ctx.logger.error(error)
      }
    }
  })

  ctx.plugin(ConversationController, { input: inputHub, blocks: composerBlocks, maxConcurrentFileUploads })
  ctx.plugin(todoDockEntry)
  ctx.plugin(queueDockEntry)

  const fileOpener: ConversationFileOpener = {
    openFile: (sessionId, path, workspaceId) => {
      if (sessions.binding(sessionId) === undefined) return false
      if (!slots.entries('conversation.view').some(entry => entry.options.id === 'file')) return false
      // Queuing this also marks the session's sticky `everOpenedFile` bit
      // (see FileOpenRegistry), which is what keeps ConversationMainPanel/
      // ConversationSessionHeader/ConversationSession (now DefaultConversation
      // Views) out of their pristine blank/Hero gate even when the session
      // has never had a first turn — otherwise a queued request would drain
      // into a hidden view.
      fileOpenRegistry.request(sessionId, path, workspaceId)
      return true
    },
  }
  ctx.provide('conversationFileOpener', fileOpener)
}
