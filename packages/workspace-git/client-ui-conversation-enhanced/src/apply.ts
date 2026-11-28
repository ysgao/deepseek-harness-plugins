/**
 * Fork of dsh-client-ui-conversation's own apply.ts -- registers the
 * same target-neutral Conversation assembly, shell, input, and docks, plus
 * the conversationFileOpener optional service (./service.ts) that lets
 * the sidebar Files tree dock a file into the current session's File tab,
 * even before that session's first turn.
 * dsh-plugins-bundle-workspace-git's cordis.patch.yml disables the
 * original ui-conversation row and installs this one in its place -- see
 * ../../../../ARCHITECTURE.md's "Replace, don't patch".
 *
 * Every registration here is unchanged from the pristine apply() except
 * registerConversationRoot, registerConversationSession, and
 * registerHeader: each inject() factory gains an everOpenedFile hook
 * (the FileOpenRegistry's sticky per-session "has a file ever been opened
 * here" bit), registerConversationSession also gains a pendingFileOpen
 * hook and completePendingFileOpen callback, and all three register this
 * package's own forked components (./ConversationRoot.tsx,
 * ./ConversationHeader.tsx, ./ConversationSession.tsx) instead of the
 * pristine ones -- their blank/Hero gate needs to stay open once
 * everOpenedFile is true, so a file opened before a session's first turn
 * doesn't land in a hidden view. The pristine package's own top-level
 * main-slot wrapper registration (ConversationPanel, mounting
 * main.conversation beneath the shared main root occupant),
 * registerConversationContent, registerSessionHeader, and
 * registerComposerBar are all reused verbatim -- none of their pristine
 * behavior reads the Hero gate any differently than before, since that
 * decision now lives entirely in the three forked components above.
 *
 * Ported forward from this pin bump (0.1.7-rc.2 -> 0.2.3-alpha.3), all
 * upstream behavior with no divergence reason to change:
 * - two new required injects, uiSession.sessionStatus and uiResponsive,
 *   for standard props (useSessionStatus, useMobile/useAccess/
 *   useDocumentPortal) that ConversationContent.tsx and InputBar.tsx (both
 *   reused unchanged) now render with;
 * - the conversation.user.text Factory slot and its
 *   conversation.user.text.node keyed child (PlainUserText/
 *   SessionReference), backing inline business-text transforms (the
 *   session-reference and whitespace-collapse/trim rules) inside message
 *   bodies;
 * - the composer-enter settings row moved from settings.general.item to
 *   settings.general.group.interaction.item;
 * - conversation.content gained conversation.hero.frame/.hero.options
 *   children, and its own inject face dropped selectWorkspace in favor of
 *   a plain moveDraft(sessionId) callback -- the actual workspace-open
 *   action (openWorkspace) is now injected once, root-level, onto
 *   main.conversation's own child declaration (shellInjected) instead of
 *   being produced per-session by conversation.content;
 * - conversation.session.header gained the conversation.session.header.
 *   views.actions list child, view pins (createViewPins/FIXED_VIEW_ID),
 *   and the request-focus inspector (inspectRequest) alongside the
 *   existing tool-call one;
 * - the composer bar gained registerFileIntake (document-level paste
 *   routing, createComposerFileIntake), a retry action, and now builds its
 *   children from the package's own exported inputBarChildren (adding
 *   conversation.input.placeholder) instead of a locally duplicated list;
 * - addFiles/createDrafts/rebindDraftFiles/moveDraft all gained a Host-
 *   upload "ordinary" flag (a subagent continuation's images travel
 *   inline instead) and addFiles sends the dropped path absolute instead
 *   of relative to cwd;
 * - the Session body's bindDraftMirror/manual-seed effect was replaced by
 *   bindDraftPersistence + inputActions.persistDraft() (ported into
 *   ./DefaultConversationViews.tsx's own fork, see that file);
 * - maxConcurrentFileUploads is now a live Host-synced reference
 *   (ObservableSnapshot<number | undefined>) instead of a one-shot plugin
 *   config number -- see the Config/fileUploadLimit note below for why
 *   this package keeps resolving the value its own way.
 *
 * Config: upstream moved maxConcurrentFileUploads into its Host-face
 * Config schema (src/index.ts), browser-synced through
 * dsh-client-modules's per-row SyncedConfig (apply(ctx, config:
 * SyncedConfig<ConversationConfig>)), keyed by Loader ROW ID. That only
 * works for a row with a live Host-side counterpart of the same id; this
 * package's own package.json declares a Client face only (`dsh.client`,
 * no `dsh.host`), under its own row id ("conversation-enhanced", not
 * "ui-conversation"), so no Host entry would ever publish values for it --
 * dsh-client-modules's own internal/config listener falls back to
 * whatever Cordis would ordinarily resolve only when this plugin keeps
 * declaring its own Config schema (checked via `fiber.runtime?.Config`).
 * This package therefore keeps its own local schemastery Config
 * (unchanged from before this pin bump: maxConcurrentFileUploads, default
 * 2) rather than adopting the SyncedConfig signature verbatim -- adopting
 * it as-is would make the field silently unconfigurable (Cordis's own
 * config resolution is bypassed for a package with a declared Config only
 * when the synced value set is empty, which it always would be here).
 * fileUploadLimit below wraps the resolved number in a stable, immutable
 * ObservableSnapshot to satisfy ConversationController's new config shape.
 *
 * Resilience (see ../../../../ARCHITECTURE.md's "Plugin isolation"):
 * every ctx.slots.register()/registerFactory() call below registers at
 * priority: -1, one lower than the pristine plugin's own default (0) --
 * if a bundle install-order violation ever leaves the pristine
 * ui-conversation row active too, both registrations land instead of the
 * second one throwing, and this one wins deterministically (lowest
 * priority renders). The two conversation.user.text.node keyed entries
 * register at priority: 99, one below the pristine's own explicit 100,
 * for the same reason (a 'keyed' slot still throws on two same-priority
 * registrations under the same key). apply() itself falls back to the
 * pristine, unmodified apply(ctx) if enhanced setup fails BEFORE any
 * registration has been attempted -- safe because nothing of this
 * plugin's has registered yet at that point. That fallback is a dynamic
 * import(), not a static top-level one: statically importing vendor's
 * apply.ts would unconditionally evaluate (and CSS-inject) vendor's whole
 * Conversation component tree on every load, including the overwhelmingly
 * common path where the fallback never fires -- see styleInjectionModule
 * in tsdown.client-plugin-preset.ts for the CSS injection tag-identity
 * collision that caused with this package's own
 * ConversationRoot.module.css. (This package's own forked skeleton files
 * import that CSS Module cross-package now, not as a local copy -- see
 * ./ConversationMainPanel.tsx's own doc comment for why -- so this
 * specific collision risk no longer applies to them, but the dynamic-import
 * discipline remains correct practice for the same reason it always was:
 * avoiding unconditional evaluation of vendor's whole component tree.)
 *
 * Once past that point each individual slot registration
 * (composer-enter settings item, conversation.user.text, the main-slot
 * wrapper, and each of the six Conversation-assembly registrations) is
 * independently try/catch-guarded instead: a failure there degrades only
 * that one row, rather than either crashing the whole app or falling back
 * to a full pristine replay that would double-register whatever already
 * succeeded.
 *
 * Divergence (recorded in scripts/replacement-parity.json): entering a
 * conversation activates the landing View (Chat) instead of the Session's
 * persisted View preference (readConversationViewPreference), because the
 * forked File view cannot restore what it was showing -- see
 * activateLandingView below and DefaultConversationViews.tsx's landing
 * effect.
 */
import type {} from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type {} from '@deepseek-ai/dsh-client-product-analytics/client'
import type { Context, VolatileSnapshot } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ISessions, SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import { IconPaperclipOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives/client'
import { createSnapshotStore, type BoundActions, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-session-status/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ShortcutCommandId, ShortcutFixedCommand } from '@deepseek-ai/dsh-client-shortcuts/client'
import { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/src/client/conversation/assembly.ts'
import { UserText, PlainUserText, SessionReference } from '@deepseek-ai/dsh-client-ui-conversation/src/client/user-text/UserText.tsx'
import { sessionReferenceRule } from '@deepseek-ai/dsh-client-ui-conversation/src/client/user-text/session-reference-rule.ts'
import { collapseWhitespaceRule, trimWhitespaceRule } from '@deepseek-ai/dsh-client-ui-conversation/src/client/user-text/whitespace-rules.ts'
import type { ConversationFocus, ConversationFocusKind, ViewTab } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/views.ts'
import { inputBarChildren } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/slots.ts'
import type {
  ComposerBarInjected, ConversationInjected, ConversationSessionHeaderInjected, ConversationShellInjected,
  ConversationSessionInjected, DraftFileUploads, UserTextInjected,
} from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/slots.ts'
import type { InputNotice } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/input.ts'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/draft-editor.ts'
import { createConversationStore } from '@deepseek-ai/dsh-client-ui-conversation/src/client/stores.ts'
import { formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
import {
  ConversationController, UnsupportedImageMediaTypeError, isImageMediaType,
} from '@deepseek-ai/dsh-client-ui-conversation/src/client/service.ts'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/src/client/service.ts'
import { ComposerBlockRegistry } from '@deepseek-ai/dsh-client-ui-conversation/src/client/input/blocks.ts'
import type { ComposerBlock } from '@deepseek-ai/dsh-client-ui-conversation/src/client/contract/composer-blocks.ts'
import { InputHub } from '@deepseek-ai/dsh-client-ui-conversation/src/client/input/hub.ts'
import { createComposerFileIntake } from '@deepseek-ai/dsh-client-ui-conversation/src/client/input/file-intake.ts'
import {
  ComposerSubmissionPolicy, DEFAULT_BUSY_ENTER_BEHAVIOR,
} from '@deepseek-ai/dsh-client-ui-conversation/src/client/input/submission-policy.ts'
import type { SyncedConfig, SyncedConfigRef } from '@deepseek-ai/dsh-client-config/types'
import type { ConversationConfig } from '@deepseek-ai/dsh-client-ui-conversation/src/types.ts'
import { queueDockEntry } from '@deepseek-ai/dsh-client-ui-conversation/src/client/queue/QueueDock.tsx'
import { installStopShortcut } from '@deepseek-ai/dsh-client-ui-conversation/src/client/stop-shortcut.ts'
import { EnterBehaviorRow } from '@deepseek-ai/dsh-client-ui-conversation/src/client/settings/EnterBehaviorRow.tsx'
import type {
  EnterBehaviorRowInjected,
} from '@deepseek-ai/dsh-client-ui-conversation/src/client/settings/EnterBehaviorRow.tsx'
import { ConversationContent } from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationContent.tsx'
import { ConversationPanel } from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationPanel.tsx'
import {
  ConversationSessionHeader as PristineConversationSessionHeader,
} from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ConversationSession.tsx'
import { InputBar } from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/InputBar.tsx'
import { todoDockEntry } from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/TodoPanel.tsx'
import { createViewPins } from '@deepseek-ai/dsh-client-ui-conversation/src/client/view-pins.ts'
import { TRAJECTORY_VIEW_ID, resolveActiveView } from '@deepseek-ai/dsh-client-ui-conversation/src/client/view-selection.ts'
import { en, ja, es, fr, de, ru, pt, NS, zh, type ConversationKey } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import {
  CONVERSATION_SETTINGS_NAMESPACE, type ConversationSettings,
} from '@deepseek-ai/dsh-client-ui-conversation/src/submission-settings.ts'
import { ConversationRoot } from './ConversationRoot.tsx'
import { ConversationHeader } from './ConversationHeader.tsx'
import { ConversationSession } from './ConversationSession.tsx'
import { FileOpenRegistry, type PendingFileOpen } from './FileOpenRegistry.ts'
import type { ConversationFileOpener } from './service.ts'

declare module '@deepseek-ai/dsh-client-ui-slots/client' {
  interface LocaleNamespaceMap {
    /** Conversation shell, composer, queue, and dock copy. */
    conversation: ConversationKey
  }
}

/**
 * Services required by the Conversation plugin. `uiSession.sessionStatus` provides the `useSessionStatus` hook the
 * Conversation shell renders with, and `uiResponsive` provides the input bar's `useMobile`, so the plugin unloads and
 * reloads with them.
 */
export const inject = [
  'slots', 'sessions', 'fileUpload', 'uiSession', 'uiSession.sessionStatus', 'uiWorkspace', 'locale', 'configForms',
  'uiResponsive',
]

/** Conversation runtime configuration. See this file's own doc comment ("Config") for why this stays local. */
export interface Config {
  /** Maximum generic-file uploads allowed to run concurrently in browser Workers. */
  maxConcurrentFileUploads?: number
}

/** Validated Conversation runtime configuration. */
export const Config: z<Config> = z.object({
  maxConcurrentFileUploads: z.natural().min(1).default(2),
})

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

/**
 * Browser-shell bridge reporting the harness-host path of a picked file. The
 * Desktop preload exposes it on the application document; a served Web page
 * has none, so every non-image file uploads there.
 */
interface HostPathBridge {
  /** Absolute harness-host path of one picked file, or empty when the shell has none for it. */
  pathFor(file: File): string
}

/** The shell-installed bridge, when this document runs inside the Desktop application. */
function hostPathBridge(): HostPathBridge | undefined {
  return (globalThis as { __DSH_HOST_PATHS__?: HostPathBridge }).__DSH_HOST_PATHS__
}

interface WorkspaceNavigation {
  openSession(sessionId: SessionId): void
  openWorkspace(
    workspaceId: Parameters<ConversationShellInjected['openWorkspace']>[0],
    beforeOpen: (sessionId: SessionId) => void,
  ): Promise<void>
}

/** Action registration used by the composer without importing its command-UI consumer. */
interface FileCommandRegistry {
  register(contribution: {
    name: string
    label(): string
    icon: typeof IconPaperclipOutlineRegular
    available(session: { sessionId: SessionId }): boolean
    ui: { kind: 'action'; run(session: { sessionId: SessionId }): void }
  }): () => void
}

/**
 * Extra hook this replacement's main.conversation registration injects.
 * The pristine row's own main.conversation contract now carries
 * ConversationShellInjected (openWorkspace) as its own slot-level inject --
 * this interface is purely additive on top of that, not a widened pristine
 * type.
 */
export interface ConversationRootInjected {
  readonly hooks: {
    /** Whether this session (absent without one) has ever opened a file -- see FileOpenRegistry. */
    readonly everOpenedFile: ObservableSnapshot<boolean>
  }
}

/**
 * Extra hook this replacement's conversation.header registration injects.
 * Same rationale as {@link ConversationRootInjected}: the pristine row's own
 * conversation.header contract carries no inject face either.
 */
export interface ConversationHeaderInjected {
  readonly hooks: {
    /** Whether this session (absent without one) has ever opened a file -- see FileOpenRegistry. */
    readonly everOpenedFile: ObservableSnapshot<boolean>
  }
}

/** Business callbacks injected into the strict Session body, widened with the file-open drain and the sticky ever-opened-a-file bit. */
export interface EnhancedConversationSessionInjected extends ConversationSessionInjected {
  readonly hooks: ConversationSessionInjected['hooks'] & {
    /** This Session's own pending conversationFileOpener request, if any. */
    readonly pendingFileOpen: ObservableSnapshot<PendingFileOpen | undefined>
    /** Whether this session has ever opened a file -- see FileOpenRegistry. */
    readonly everOpenedFile: ObservableSnapshot<boolean>
  }
  /** Acknowledge the current pending file-open request (one-shot, mirrors completeViewRequest). */
  completePendingFileOpen: () => void
}

/** Resolve the session-scoped Conversation action face, failing loud. */
function scopedConversation(sessions: ISessions, id: SessionId): IConversation {
  const scoped = sessions.scope(id)
  if (scoped === undefined) throw new Error('ui-conversation: session "' + id + '" resolved no scope')
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
  // ConversationController now expects a live Host-synced reference (a
  // raised limit starts queued uploads at once); this package resolves the
  // value once locally instead (see this file's own doc comment, "Config"),
  // so the reference never changes but still satisfies the new shape.
  const fileUploadLimit: ObservableSnapshot<number | undefined> = {
    getSnapshot: () => maxConcurrentFileUploads,
    subscribe: () => () => {},
  }
  let workspaceNavigation: WorkspaceNavigation
  let uiConversation: UiConversation
  let fileOpenRegistry: FileOpenRegistry
  try {
    workspaceNavigation = ctx.get('uiWorkspace') as unknown as WorkspaceNavigation
    uiConversation = new UiConversation(ctx, sessions)
    fileOpenRegistry = new FileOpenRegistry()
    uiConversation.userText.register(sessionReferenceRule)
    uiConversation.userText.register(collapseWhitespaceRule)
    uiConversation.userText.register(trimWhitespaceRule)
    ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-conversation: dictionaries')
  } catch (error) {
    // Nothing of this plugin's has registered yet at this point, so a full
    // pristine replay is safe -- see this file's own doc comment.
    ctx.logger.error(
      'dsh-plugins-client-ui-conversation-enhanced: enhanced setup failed -- falling back to the pristine dsh-client-ui-conversation plugin',
    )
    ctx.logger.error(error)
    // Dynamic, not static -- see this file's own doc comment.
    const { apply: pristineApply } = await import('@deepseek-ai/dsh-client-ui-conversation/src/client/apply.ts')
    // The pristine apply's own Config is the full Host-synced
    // `SyncedConfig<ConversationConfig>` (vendor pin 841f76d3 added
    // `busyEnter` alongside `maxConcurrentFileUploads`), not this package's
    // narrower local `Config` -- see this file's own doc comment ("Config")
    // for why this package never adopted that shape for its own normal
    // path. This fallback path has no live Host sync to defer to either, so
    // it hands the pristine plugin static refs: this package's own resolved
    // upload limit, and the shared default busyEnter behavior (the pristine
    // plugin's own ComposerSubmissionPolicy — never constructed on this
    // failure path — would have started at that same default).
    // T is always a primitive here (number, or the BusyEnterBehavior string
    // union), so VolatileSnapshot<T> (object-shaped values recurse into
    // their own fields; anything else is itself) reduces to T -- the cast
    // states that reduction, which a generic T can't verify structurally.
    const syncedConfigRef = <T,>(value: T): SyncedConfigRef<T> => ({
      get: () => value as VolatileSnapshot<T>,
      getSnapshot: () => value as VolatileSnapshot<T>,
      subscribe: () => () => {},
    })
    pristineApply(ctx, {
      maxConcurrentFileUploads: syncedConfigRef(maxConcurrentFileUploads),
      busyEnter: syncedConfigRef(DEFAULT_BUSY_ENTER_BEHAVIOR),
    } satisfies SyncedConfig<ConversationConfig>)
    return
  }
  const t = ctx.locale.bind(NS)
  const conversationStore = createConversationStore()
  const submissionPolicy = new ComposerSubmissionPolicy(
    ctx.configForms.get<ConversationSettings>(CONVERSATION_SETTINGS_NAMESPACE),
  )

  ctx.effect(() => () => { submissionPolicy.dispose() })

  try {
    slots.registerFactory({
      name: 'conversation.user.text',
      scope: 'session',
      inline: true,
      children: {
        'conversation.user.text.node': { kind: 'keyed', scope: 'session', inline: true },
      },
      inject: (): UserTextInjected => ({
        hooks: {
          userTextRevision: {
            getSnapshot: () => uiConversation.userText.getSnapshot(),
            subscribe: listener => uiConversation.userText.subscribe(listener),
          },
        },
        createUserTextEvaluator: () => uiConversation.userText.createEvaluator(),
        reportTransformFailure: (error) => { console.error('[ui-conversation] user-text transformation failed:', error) },
      }),
    }, UserText)
  } catch (error) {
    ctx.logger.error('dsh-plugins-client-ui-conversation-enhanced: failed to register conversation.user.text')
    ctx.logger.error(error)
  }
  slots.inject('conversation.user.text.node', function* () {
    // One below the pristine's own explicit 100 -- see this file's own doc
    // comment ("Resilience") for why a keyed slot needs this too.
    try {
      yield slots.register({ name: 'conversation.user.text.node', key: 'text', priority: 99 }, PlainUserText)
    } catch (error) {
      ctx.logger.error('dsh-plugins-client-ui-conversation-enhanced: failed to register conversation.user.text.node "text"')
      ctx.logger.error(error)
    }
    try {
      yield slots.register({ name: 'conversation.user.text.node', key: 'session', priority: 99 }, SessionReference)
    } catch (error) {
      ctx.logger.error('dsh-plugins-client-ui-conversation-enhanced: failed to register conversation.user.text.node "session"')
      ctx.logger.error(error)
    }
  })

  ctx.slots.inject('settings.general.group.interaction.item', () => {
    try {
      return ctx.slots.register({
        name: 'settings.general.group.interaction.item',
        id: 'composer-enter',
        priority: -1,
        order: 0,
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
      if (!ctx.configForms.developerTools.enabled.getSnapshot() && entry.options.id === TRAJECTORY_VIEW_ID) continue
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
  // Pristine dsh-client-ui-conversation seeds this from the Session's own
  // persisted View preference (readConversationViewPreference). This fork
  // deliberately ignores that preference and activates the landing View
  // (null -> resolveActiveView's Chat default) instead, because every
  // mount of a Session's subtree now lands on Chat regardless of what was
  // persisted -- see ./DefaultConversationViews.tsx's own landing effect
  // for why (the File view cannot restore what it was showing). Activation
  // is monotonic per Session, so a View the user then selects by hand
  // (selectView/openView below) still activates on its own.
  const activateLandingView = (sessionId: SessionId): void => {
    activateView(sessionId, null)
  }
  const conversationViews = createSnapshotStore<readonly ViewTab[]>(viewTabs())
  const viewPins = createViewPins()
  const viewActions = {
    getSnapshot: () => slots.entriesOfSlot('conversation.session.header.views.actions').length > 0,
    subscribe: (listener: () => void) => slots.subscribe('conversation.session.header.views.actions', listener),
  }
  const bindings = new Set<SessionBinding>()
  const trackedBindings = new WeakSet<SessionBinding>()
  const trackBinding = (binding: SessionBinding): void => {
    if (trackedBindings.has(binding)) return
    trackedBindings.add(binding)
    bindings.add(binding)
    binding.ctx.effect(() => () => { bindings.delete(binding) }, 'ui-conversation: active Provider binding')
  }
  const refreshViews = (): void => {
    const current = conversationViews.getSnapshot()
    const next = viewTabs()
    const unchanged = current.length === next.length
      && current.every((tab, index) => {
        const candidate = next.at(index)
        return candidate !== undefined && tab.id === candidate.id && tab.label === candidate.label
      })
    if (!unchanged) conversationViews.set(next)
    for (const binding of bindings) activateLandingView(binding.sessionId)
  }
  ctx.effect(() => {
    const disposeViews = slots.subscribe('conversation.view', refreshViews)
    const disposeLocale = ctx.locale.subscribe(refreshViews)
    const disposeDeveloperTools = ctx.configForms.developerTools.enabled.subscribe(refreshViews)
    return () => {
      disposeDeveloperTools()
      disposeLocale()
      disposeViews()
    }
  }, 'ui-conversation: View selection')

  // FileOpenRegistry's pending/everOpened/hook Maps and Sets are keyed by
  // SessionId and never pruned on their own (see FileOpenRegistry.forget's
  // own doc comment) -- release a session's entries once it drops out of
  // the Host-authoritative list, mirroring vendor's own
  // ComposerBlockRegistry.forget contract.
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

  const stop = (sessionId: SessionId): void => {
    scopedConversation(sessions, sessionId).cancel().catch((_error: unknown) => {
      // Stop failure is published through Session promptError.
    })
  }
  const stopShortcut = createSnapshotStore<readonly string[]>([])
  ctx.inject(['shortcuts'], (scope) => {
    const fixedInputs: readonly ShortcutFixedCommand[] = [
      { id: 'fixed.send' as ShortcutCommandId, label: () => t('input.send'), keys: ['Enter'],
        bindings: [{ code: 'Enter', modifiers: [] }], group: 'input' },
      { id: 'fixed.newline' as ShortcutCommandId, label: () => t('shortcut.newline'),
        keys: scope.shortcuts.describeBinding({ code: 'Enter', modifiers: ['shift'] }).keys,
        bindings: [{ code: 'Enter', modifiers: ['shift'] }], group: 'input' },
      { id: 'fixed.complementary' as ShortcutCommandId, label: () => t('shortcut.complementary'),
        keys: scope.shortcuts.describeBinding({ code: 'Enter', modifiers: ['primary'] }).keys,
        bindings: [{ code: 'Enter', modifiers: ['control'] }, { code: 'Enter', modifiers: ['meta'] }], group: 'input' },
      { id: 'fixed.slash' as ShortcutCommandId, label: () => t('shortcut.slash'), keys: ['/'],
        bindings: [{ code: 'Slash', modifiers: [] }], group: 'input' },
      { id: 'fixed.mention' as ShortcutCommandId, label: () => t('shortcut.mention'), keys: ['@'],
        bindings: [{ code: 'Digit2', modifiers: ['shift'] }], group: 'input' },
    ]
    for (const command of fixedInputs) {
      scope.effect(() => scope.shortcuts.registerFixed(command), 'ui-conversation: ' + command.id)
    }
    scope.effect(() => installStopShortcut(
      scope.shortcuts, sessions, binding => uiConversation.binding(binding).openTurn, ctx.uiSession, stop,
    ), 'ui-conversation: fixed stop input')
    scope.effect(() => {
      const command: ShortcutFixedCommand = {
        id: 'response.stop' as ShortcutCommandId, label: () => t('input.stop'), keys: ['Esc', 'Esc'], bindings: [{ code: 'Escape', modifiers: [] }], group: 'input',
      }
      const dispose = scope.shortcuts.registerFixed(command)
      stopShortcut.set(command.keys)
      return () => { stopShortcut.set([]); dispose() }
    }, 'ui-conversation: fixed stop reference')
  })

  const inputHub = new InputHub(ctx, t)
  const composerBlocks = new ComposerBlockRegistry()

  ctx.inject(['commandUi'], (scope) => {
    const commands = scope.get('commandUi') as FileCommandRegistry
    scope.effect(() => commands.register({
      name: 'file',
      label: () => t('input.file'),
      icon: IconPaperclipOutlineRegular,
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
      trackBinding(binding)
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

  // Injected once, root-level, onto main.conversation's own child
  // declaration below -- see this file's own doc comment ("Ported forward
  // from this pin bump") for why this replaces conversation.content's old
  // per-session selectWorkspace.
  const shellInjected: ConversationShellInjected = {
    openWorkspace: (workspaceId, adopt) => workspaceNavigation.openWorkspace(workspaceId, adopt),
  }

  const registerConversationRoot = () => slots.register({
    name: 'main.conversation',
    priority: -1,
    children: {
      'conversation.header': { kind: 'single', scope: 'session-maybe' },
    },
    inject: (sessionId: SessionId | undefined): ConversationRootInjected => ({
      hooks: {
        everOpenedFile: sessionId === undefined ? ABSENT_EVER_OPENED : fileOpenRegistry.hookForEverOpened(sessionId),
      },
    }),
  }, ConversationRoot)

  const registerConversationContent = () => slots.registerFactory({
    name: 'conversation.content',
    scope: 'session-maybe',
    locale: NS,
    children: {
      'conversation.session': { kind: 'single', scope: 'session' },
      'conversation.composer': { kind: 'chain', scope: 'session' },
      'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'conversation.hero.frame': { kind: 'hoc', scope: 'root' },
      'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
      'conversation.hero.workspace': { kind: 'single', scope: 'root' },
      'conversation.hero.agentPreset': { kind: 'single', scope: 'session-maybe' },
      'conversation.hero.options': { kind: 'list', scope: 'session' },
    },
    slots: {
      views: { scope: 'session' },
      widthControls: { scope: 'root' },
    },
    inject: (sessionId: SessionId | undefined): ConversationInjected => ({
      hooks: {
        composerBlock: sessionId === undefined ? ABSENT_BLOCK : composerBlocks.storeFor(sessionId),
      },
      moveDraft: (nextId) => {
        if (sessionId !== undefined && nextId !== sessionId) {
          const from = inputHub.shell(sessionId)
          // A draft with a submission in flight stays with the Session that is admitting it.
          if (from.snapshot.phase !== 'plain' && from.snapshot.phase !== 'claimed') return
          const draft = from.draftSnapshot
          const attachmentIds = from.snapshot.attachmentIds
          const next = inputHub.shell(nextId)
          if (attachmentIds.length === 0 || next.addAttachments(attachmentIds)) {
            const binding = sessions.binding(nextId)
            if (binding === undefined) {
              throw new Error('ui-conversation: session "' + nextId + '" resolved no binding')
            }
            // The same rule as intake: only an ordinary Session stages image uploads.
            const ordinary = binding.session.getSnapshot().subagent === null
            concreteConversation(ctx).rebindDraftFiles(nextId, attachmentIds, ordinary)
            if (draft.text !== '') {
              next.setDraft(draft)
              from.setDraft('')
            }
            if (attachmentIds.length > 0) {
              for (const id of attachmentIds) from.removeAttachment(id)
            }
          }
        }
      },
    }),
  }, ConversationContent)

  const registerConversationSession = () => slots.register({
    name: 'conversation.session',
    priority: -1,
    children: {
      'conversation.view': { kind: 'list', scope: 'session' },
    },
    store: conversationStore,
    inject: (
      sessionId: SessionId, actions: BoundActions<typeof conversationStore>,
    ): EnhancedConversationSessionInjected => {
      const openView = (view: string, focus: ConversationFocus): void => {
        if (!viewTabs().some(tab => tab.id === view)) return
        const definition = uiConversation.views.entries().find(entry => entry.target === view)
        if (definition?.accepts?.includes(focus.kind) !== true) return
        activateView(sessionId, view)
        actions.openView(view, focus)
      }
      const inspectionTarget = (kind: ConversationFocusKind) => uiConversation.views.entries().find(definition =>
        definition.accepts?.includes(kind) === true
        && conversationViews.getSnapshot().some(view => view.id === definition.target),
      )
      const inspect = (focus: ConversationFocus): void => {
        const target = inspectionTarget(focus.kind)
        if (target !== undefined) openView(target.target, focus)
      }
      const inspectCall = (callId: string): void => { inspect({ kind: 'tool-call', callId }) }
      const inspectRequest = (turn: number, step: number): void => { inspect({ kind: 'request', turn, step }) }
      const subscribeInspection = (listener: () => void): () => void => {
        const disposeViews = conversationViews.subscribe(listener)
        const disposeDefinitions = uiConversation.views.subscribe(listener)
        return () => { disposeViews(); disposeDefinitions() }
      }
      return {
        hooks: {
          conversationViews,
          inspectCall: {
            getSnapshot: () => inspectionTarget('tool-call') === undefined ? undefined : inspectCall,
            subscribe: subscribeInspection,
          },
          inspectRequest: {
            getSnapshot: () => inspectionTarget('request') === undefined ? undefined : inspectRequest,
            subscribe: subscribeInspection,
          },
          pendingFileOpen: fileOpenRegistry.hookFor(sessionId),
          everOpenedFile: fileOpenRegistry.hookForEverOpened(sessionId),
        },
        bindDraftPersistence: write => inputHub.shell(sessionId).bindDraftPersistence(write),
        openView,
        completePendingFileOpen: () => { fileOpenRegistry.complete(sessionId) },
      }
    },
  }, ConversationSession)

  const registerHeader = () => slots.register({
    name: 'conversation.header',
    priority: -1,
    children: {
      'conversation.header.leading': { kind: 'single', scope: 'root' },
      'conversation.session.header': { kind: 'single', scope: 'session' },
    },
    inject: (sessionId: SessionId | undefined): ConversationHeaderInjected => ({
      hooks: {
        everOpenedFile: sessionId === undefined ? ABSENT_EVER_OPENED : fileOpenRegistry.hookForEverOpened(sessionId),
      },
    }),
  }, ConversationHeader)

  const registerSessionHeader = () => slots.register({
    name: 'conversation.session.header',
    priority: -1,
    locale: NS,
    children: {
      'conversation.session.header.lineage': { kind: 'single', scope: 'session' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      'conversation.session.header.corner': { kind: 'single', scope: 'session' },
      'conversation.session.header.views.actions': { kind: 'list', scope: 'root' },
    },
    store: conversationStore,
    inject: (sessionId: SessionId, actions: BoundActions<typeof conversationStore>): ConversationSessionHeaderInjected => ({
      hooks: { conversationViews, entryPins: viewPins.unpinned, entryActions: viewActions },
      setPinned: viewPins.setPinned,
      open: (id) => { workspaceNavigation.openSession(id) },
      selectView: (view) => {
        activateView(sessionId, view)
        actions.setView(view)
      },
    }),
  }, PristineConversationSessionHeader)

  const fileIntake = createComposerFileIntake()
  const registerComposerBar = () => slots.register({
    name: 'conversation.composer.bar',
    priority: -1,
    locale: NS,
    children: inputBarChildren,
    inject: (sessionId: SessionId | undefined): ComposerBarInjected => {
      if (sessionId === undefined) {
        return {
          registerFileIntake: fileIntake,
          keyboard: undefined,
          addFiles: undefined,
          removeAttachment: undefined,
          resolveDraftAttachments: undefined,
          retryFileUpload: undefined,
          toggleCommandMenu: undefined,
          stop: undefined,
          retry: undefined,
          hooks: {
            stopShortcut,
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
      const bridge = hostPathBridge()
      return {
        registerFileIntake: fileIntake,
        keyboard: shell,
        addFiles: (files, directories = new Set()) => {
          if (sessions.binding(sessionId) === undefined) return t('file.sessionUnavailable')
          const { phase } = shell.snapshot
          if (phase === 'adjudicating' || phase === 'submitting' || phase === 'sending') {
            return t('attachment.dropBlocked')
          }
          const uploads: File[] = []
          const references: ReferenceInsert[] = []
          for (const file of files) {
            const directory = directories.has(file)
            if (bridge === undefined && directory) return t('attachment.directoryDesktopOnly')
            const path = bridge?.pathFor(file) ?? ''
            if (directory && path === '') return t('attachment.pathUnavailable')
            if (path === '' || (!directory && isImageMediaType(file.type))) {
              uploads.push(file)
              continue
            }
            // The dropped path stays absolute, so the sent text names the same file after the Session's directory moves.
            // A completed directory chip needs closed quotes; the directory grammar keeps them open for drill.
            const mention = formatFileMention({ path: directory ? path + '/' : path, kind: 'file' }, false)
            if (mention === undefined) return t('attachment.pathUnsupported')
            const label = workspaceTitleOf(path) || file.name
            references.push({
              source: 'reference', ref: mention, label: directory ? label + '/' : label,
              appearance: directory ? 'folder' : 'file', clipboardText: mention,
            })
          }
          try {
            // The Host stages uploads for ordinary Sessions only; a subagent continuation's images travel inline.
            const ordinary = sessions.binding(sessionId)?.session.getSnapshot().subagent === null
            const drafts = conversation.createDrafts(sessionId, uploads, ordinary === true)
            if (!shell.addFiles(references, drafts.map(draft => draft.id))) {
              conversation.releaseDraftAttachments(drafts)
              return t('attachment.dropBlocked')
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
        stop: () => { stop(sessionId) },
        retry: (failureSeq) => { inputHub.retry(sessionId, failureSeq) },
        hooks: {
          stopShortcut,
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
          children: { 'main.conversation': { kind: 'single', scope: 'session-maybe', inject: shellInjected } },
        }, ConversationPanel),
      },
      { label: 'main.conversation', register: registerConversationRoot },
      { label: 'conversation.content', register: registerConversationContent },
      { label: 'conversation.session', register: registerConversationSession },
      { label: 'conversation.header', register: registerHeader },
      { label: 'conversation.session.header', register: registerSessionHeader },
      { label: 'conversation.composer.bar', register: registerComposerBar },
    ]
    // Each registration is independently guarded: the 'main' row declares
    // main.conversation, registerConversationRoot declares 'conversation.header'
    // (registerHeader's own target), registerConversationContent declares the
    // rest of the child slots the remaining registrations register into, so
    // a failure upstream leaves the dependent ones with nothing to register
    // into -- catching each individually still means every failure here logs
    // and is skipped, never propagates out of this generator to crash the
    // whole Client boot.
    for (const { label, register } of attempts) {
      try {
        yield register()
      } catch (error) {
        ctx.logger.error('dsh-plugins-client-ui-conversation-enhanced: failed to register ' + label)
        ctx.logger.error(error)
      }
    }
  })

  ctx.plugin(ConversationController, {
    input: inputHub,
    blocks: composerBlocks,
    maxConcurrentFileUploads: fileUploadLimit,
  })
  ctx.plugin(todoDockEntry)
  ctx.plugin(queueDockEntry)

  const fileOpener: ConversationFileOpener = {
    openFile: (sessionId, path, workspaceId) => {
      if (sessions.binding(sessionId) === undefined) return false
      if (!slots.entries('conversation.view').some(entry => entry.options.id === 'file')) return false
      // Queuing this also marks the session's sticky everOpenedFile bit
      // (see FileOpenRegistry), which is what keeps ConversationRoot/
      // ConversationHeader/ConversationSession (via DefaultConversationViews)
      // out of their pristine blank/Hero gate even when the session has
      // never had a first turn -- otherwise a queued request would drain
      // into a hidden view.
      fileOpenRegistry.request(sessionId, path, workspaceId)
      return true
    },
  }
  ctx.provide('conversationFileOpener', fileOpener)
}
