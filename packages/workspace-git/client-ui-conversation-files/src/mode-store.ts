/**
 * The mediator between the File tab's mode state and the document toolbar
 * that drives it.
 *
 * The View/Edit/Diff controls belong, visually, in the relocated preview
 * engine's own header toolbar — one row of controls over the file, not two
 * stacked ones. But that toolbar is drawn by the engine's body, which is
 * mounted only while the tab is in View mode: controls registered into
 * `sidebar.right.tab.document.actions` and nowhere else would disappear the
 * moment Edit was pressed, stranding the reader in a mode with no way back.
 *
 * So the controls are one component (`./FileActions.tsx`) with two mount
 * points — the engine's toolbar while the engine is drawing, the tab's own
 * header when it is not — and this store is what lets those two mounts be
 * the same control. `FileView` keeps owning the state, as it always has: the
 * draft cache, the `writeFile` version guard and the conflict notice are
 * its, and relocating them would mean duplicating them. It publishes a flat
 * snapshot here, and whichever mount is live subscribes.
 *
 * One store per session, handed to both the view entry and the toolbar entry
 * from the same `apply()` in `./apply.ts`, so the two always address the
 * same tab.
 * @module dsh-plugins-client-ui-conversation-files/mode-store
 */

/** Which body the File tab shows for the opened path. */
export type FileViewMode = 'view' | 'edit' | 'diff'

/** How a save attempt on the open draft last ended. */
export type FileSavePhase = 'idle' | 'saving' | 'conflict' | 'error'

/**
 * Everything the toolbar draws, flattened by `FileView` so the toolbar needs
 * no props of its own. Every field describes the file currently open;
 * `path === null` is the resting state, and the toolbar draws nothing.
 */
export interface FileToolbarSnapshot {
  /** The opened path, or null while the tab is resting. */
  readonly path: string | null
  /** The current mode. */
  readonly mode: FileViewMode
  /** Whether this file can be edited — any text kind (Markdown, ontology, delimited, RTF included) whose text has loaded. */
  readonly canEdit: boolean
  /** Whether this file has a pending git change to diff against `HEAD`. */
  readonly canDiff: boolean
  /** Whether the open draft differs from what is on disk. */
  readonly dirty: boolean
  /** How the last save attempt ended. */
  readonly save: FileSavePhase
  /**
   * Whether the model-backed "next sentence" ghost-text upgrade is turned
   * on — a per-browser preference (see `./ai-prediction-preference.ts`),
   * republished here so the toolbar can show and toggle it without its own
   * copy of that state. Meaningful only in Edit mode, but always present so
   * `same()` below stays a flat field comparison; `FileActions` decides
   * when to actually draw the indicator.
   */
  readonly aiPredictionEnabled: boolean
}

/** The resting snapshot: no file, nothing to offer. */
export const RESTING_SNAPSHOT: FileToolbarSnapshot = {
  path: null, mode: 'view', canEdit: false, canDiff: false, dirty: false, save: 'idle', aiPredictionEnabled: false,
}

/** What `FileView` publishes alongside its snapshot: the actions only it can perform. */
export interface FileToolbarHandlers {
  /** Switch mode. @param mode - the requested mode. */
  readonly setMode: (mode: FileViewMode) => void
  /** Write the open draft through the version guard. */
  readonly save: () => void
  /** Drop the open draft and re-read the file (offered by the conflict notice). */
  readonly discardAndReload: () => void
  /** Flip the model-backed ghost-text preference and persist the new value. */
  readonly toggleAiPrediction: () => void
}

/** Handlers before `FileView` has mounted; each a no-op rather than a crash. */
const NO_HANDLERS: FileToolbarHandlers = {
  setMode: () => {}, save: () => {}, discardAndReload: () => {}, toggleAiPrediction: () => {},
}

/** Whether two snapshots say the same thing. */
function same(left: FileToolbarSnapshot, right: FileToolbarSnapshot): boolean {
  return left.path === right.path && left.mode === right.mode && left.canEdit === right.canEdit
    && left.canDiff === right.canDiff && left.dirty === right.dirty && left.save === right.save
    && left.aiPredictionEnabled === right.aiPredictionEnabled
}

/** One File tab's toolbar state, shared between the tab and whichever toolbar draws its controls. */
export class FileModeStore {
  private snapshot: FileToolbarSnapshot = RESTING_SNAPSHOT
  private handlers: FileToolbarHandlers = NO_HANDLERS
  private readonly listeners = new Set<() => void>()
  private hosted = false
  private readonly hostedListeners = new Set<() => void>()

  /**
   * Read the current toolbar state.
   * @returns the same object identity until `publish` changes something —
   * `useSyncExternalStore` requires that, and the editor publishes on every
   * keystroke.
   */
  readonly getSnapshot = (): FileToolbarSnapshot => this.snapshot

  /**
   * Observe toolbar-state changes.
   * @param listener - change observer.
   * @returns its disposer.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Read the actions the tab published. Not part of the subscribed snapshot:
   * these close over the tab's latest render and change identity constantly,
   * so comparing them would defeat the equality check above.
   * @returns the live handlers, or no-ops before the tab mounted.
   */
  readonly getHandlers = (): FileToolbarHandlers => this.handlers

  /**
   * Publish the tab's current state.
   * @param next - the new snapshot; notifies only when it actually differs.
   * @param handlers - the actions bound to this render.
   */
  publish(next: FileToolbarSnapshot, handlers: FileToolbarHandlers): void {
    this.handlers = handlers
    if (same(this.snapshot, next)) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }

  /**
   * Whether the preview engine's own toolbar is currently drawing these
   * controls.
   *
   * Set by the `sidebar.right.tab.document.actions` entry while it is
   * mounted, and read by `FileView` to decide whether to draw them in its
   * own header. Deliberately not part of the published snapshot: that one
   * flows tab -> toolbar, this flows toolbar -> tab, and folding them
   * together would make each side's write wake the other's reader for
   * nothing.
   * @returns whether the engine's toolbar has the controls.
   */
  readonly getHosted = (): boolean => this.hosted

  /**
   * Observe where the controls are drawn.
   * @param listener - change observer.
   * @returns its disposer.
   */
  readonly subscribeHosted = (listener: () => void): (() => void) => {
    this.hostedListeners.add(listener)
    return () => { this.hostedListeners.delete(listener) }
  }

  /**
   * Claim or release the controls for the engine's toolbar.
   * @param value - whether that toolbar is mounted and drawing them.
   */
  setHosted(value: boolean): void {
    if (this.hosted === value) return
    this.hosted = value
    for (const listener of this.hostedListeners) listener()
  }

  /**
   * Return to rest when the tab unmounts, so a closed file never lingers in
   * a toolbar. `hosted` is left alone: it tracks the toolbar entry's own
   * mount, which this tab does not own.
   */
  clear(): void {
    this.handlers = NO_HANDLERS
    if (same(this.snapshot, RESTING_SNAPSHOT)) return
    this.snapshot = RESTING_SNAPSHOT
    for (const listener of this.listeners) listener()
  }
}

/**
 * One store per session, created on first use.
 *
 * Keyed rather than single because `conversation.view` and the document
 * actions slot are both `scope: 'session'`: two conversations open at once
 * are two File tabs, each with its own mode.
 */
export class FileModeStores {
  private readonly bySession = new Map<string, FileModeStore>()

  /**
   * The store for one session.
   * @param sessionId - the conversation the File tab belongs to.
   * @returns that session's store, created if this is its first use.
   */
  for(sessionId: string): FileModeStore {
    const existing = this.bySession.get(sessionId)
    if (existing !== undefined) return existing
    const created = new FileModeStore()
    this.bySession.set(sessionId, created)
    return created
  }

  /**
   * Drop a session's store once nothing is drawing its File tab.
   *
   * Called from the tab's own unmount. Without it this map is append-only
   * for the life of the page, and a client that visits many conversations
   * accumulates one store per conversation it ever opened. Re-entering a
   * dropped session simply creates a fresh store, which is correct: the tab
   * publishes its whole snapshot on mount.
   * @param sessionId - the conversation whose File tab unmounted.
   * @param store - the store that tab held, dropped only if it is still the
   * one registered — a remount that already replaced it must not be evicted
   * by the old tab's late cleanup.
   */
  release(sessionId: string, store: FileModeStore): void {
    if (this.bySession.get(sessionId) !== store) return
    this.bySession.delete(sessionId)
  }
}
