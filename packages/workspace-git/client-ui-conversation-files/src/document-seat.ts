/**
 * The seam the preview engine is relocated onto: one document seat inside
 * the conversation's File tab, and the tab information a body registered
 * into it reads.
 *
 * The seat is declared HERE, by the package that draws it, not by the one
 * that fills it: a slot has exactly one declaring entry, and that entry is
 * this package's File tab. `dsh-plugins-client-ui-document-host` registers
 * into it by name and needs nothing from this module.
 *
 * `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`'s bodies are written
 * against the right Sidebar's tab contract — they read everything they need
 * from `useTabInfo()`, and nothing from owner props. That is precisely what
 * makes them relocatable: a seat that can answer `useTabInfo()` can host
 * them, wherever it is drawn. This module declares such a seat in the File
 * tab and synthesizes that answer from the tab's own state.
 *
 * `kind: 'single'`, deliberately. The right Sidebar's own seat is keyed
 * because it dispatches among many tab types in one pane; the File tab shows
 * one file, in one place, so a second occupant would be an ambiguity rather
 * than a feature — and `single` also spares the File tab from naming another
 * package's implementation id to dispatch on.
 * @module dsh-plugins-client-ui-conversation-files/document-seat
 */
import { useMemo } from 'react'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { PaneId, TabRecord } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SlotHookFactory } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  SidebarRightTabActions, SidebarRightTabNavigation, UseSidebarRightTabInfo,
} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

/**
 * The pane id reported to a relocated body. Bodies use it to key per-pane
 * state and to compare panes; the File tab has exactly one, so one constant
 * identity is the honest answer rather than a fabricated unique id per mount.
 */
export const FILE_TAB_PANE_ID = 'conversation-file-tab' as PaneId

/**
 * What the File tab tells the seat about the file it is showing. Supplied by
 * the tab at render time (the same way the right Sidebar's own seat supplies
 * its `TabHookContext`), never by the body.
 */
export interface FileDocumentHookContext {
  /** The synthesized record: `contentId` is the file's resource address. */
  readonly tab: TabRecord
  /** What the current open carried — the address, its params, and a revision that changes per open. */
  readonly navigation: SidebarRightTabNavigation
  /** Whether the File tab is the conversation's selected view right now. */
  readonly visible: boolean
  /** Aborted when the tab stops showing this file, or the conversation unmounts. */
  readonly signal: AbortSignal
  /** What a body may do to the tab it is in: bind refresh, open another resource, close. */
  readonly actions: SidebarRightTabActions
  /** Keyboard catalog, for a body that labels its own refresh control; empty when no shortcuts plugin is composed in. */
  readonly shortcuts: readonly ShortcutCatalogEntry[]
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The document body for the file the conversation's File tab is showing.
     *
     * Registered into by `dsh-plugins-client-ui-document-host`, which puts
     * the vendored preview engine's own seat here instead of in the right
     * Sidebar. Unregistered is a normal state: the File tab then draws its
     * own preview, exactly as it did before this seat existed.
     */
    'conversation.file.document': {
      kind: 'single'
      scope: 'session'
      hookContext: FileDocumentHookContext
      inject: { hooks: { tabInfo: SlotHookFactory<'conversation.file.document', UseSidebarRightTabInfo> } }
    }
  }
}

/**
 * Answer `useTabInfo()` for a body drawn in the File tab.
 *
 * Every field the right Sidebar's own factory derives from the dock's live
 * layout store has a settled counterpart here, because the File tab's layout
 * is not negotiable: one pane, always expanded, never fullscreen. What
 * genuinely varies — which file, which navigation, whether the tab is the
 * selected view — comes from the context the tab supplies.
 * @param _standard - framework standard props; the session is already in the context's records.
 * @param context - the File tab's own description of what it is showing.
 * @returns the tab information hook the relocated bodies read.
 */
export const fileDocumentTabInfoFactory: SlotHookFactory<'conversation.file.document', UseSidebarRightTabInfo> = (
  _standard,
  context,
) => {
  const { tab, navigation, visible, signal, actions, shortcuts } = context
  return function useTabInfo() {
    // Memoized, and not as an optimization. A body reads this on every
    // render and keys effects off the objects in it; returning fresh
    // literals re-fires those effects, and a body that sets state in one
    // never settles. The spreadsheet grid did exactly that until the tab
    // stopped churning the context beneath it (see ./apply.ts), and React
    // ended it with "Maximum update depth exceeded" (#185). Stable
    // identities here mean a body cannot be driven into that loop again by
    // a caller that re-renders more often than upstream's own Sidebar does.
    return useMemo(() => ({
      // `expanded: true` is a statement of fact, not a default: a body is
      // only rendered here while the File tab is mounted, and a mounted File
      // tab is on screen. Bodies that skip work while collapsed would
      // otherwise never load anything.
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: FILE_TAB_PANE_ID },
      tab: {
        ...tab,
        visible,
        navigation,
        signal,
        actions,
        refreshShortcut: shortcuts.find(row => row.id === 'page.refresh'),
      },
    }), [tab, navigation, visible, signal, actions, shortcuts])
  }
}
