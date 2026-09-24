/**
 * What the right Sidebar shows for a file address once the preview engine
 * draws in the File tab instead: nothing, for as long as it takes to send
 * the file where it now belongs.
 *
 * The `text` tab type stays registered — `openResource` throws for an
 * address no type claims, and conversation file links, tool line references
 * and this bundle's own Files tree all navigate through it. Claiming the
 * address and immediately forwarding it keeps every one of those callers
 * working, unchanged, while honouring the one thing this whole relocation is
 * for: a file opens in the middle.
 *
 * If the forward cannot happen — no File-tab package composed in, no session
 * binding — the tab says so and stays put rather than closing itself into a
 * dead end. That is a real state (this package installed without
 * `dsh-plugins-client-ui-conversation-files`), not a defect.
 * @module dsh-plugins-client-ui-document-host/HandoffBody
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './HandoffBody.module.css'

/** What the hand-off needs from its plugin: where to send a file, and what to say when it cannot. */
export interface HandoffInjected {
  /**
   * Forward one file resource address to the File tab.
   * @param address - the `dsh-resource://file/session/<id>/<path>` address the tab was opened at.
   * @returns whether the File tab accepted it.
   */
  readonly handoff: (address: string) => boolean
  /** Localized line shown when nothing accepted the file. */
  readonly refusalLabel: () => string
}

/** Standard tab-body props plus this package's own hand-off wiring. */
export type HandoffBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & HandoffInjected

/**
 * Forward this tab's file to the File tab, then close.
 * @param props - the framework's tab props and the hand-off wiring.
 * @returns nothing while forwarding; the refusal line when it could not.
 */
export function HandoffBody({ useTabInfo, handoff, refusalLabel }: HandoffBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const [refused, setRefused] = useState(false)
  const { contentId, actions } = tab
  useEffect(() => {
    // Closing from inside a layout commit is what the tab's own actions are
    // for; doing it in an effect (not during render) keeps the close in the
    // commit after this body first appeared, so the dock never tears down a
    // pane it is still rendering into.
    if (handoff(contentId)) actions.close()
    else setRefused(true)
  }, [contentId, actions, handoff])
  return refused ? <p className={css.refusal}>{refusalLabel()}</p> : null
}
