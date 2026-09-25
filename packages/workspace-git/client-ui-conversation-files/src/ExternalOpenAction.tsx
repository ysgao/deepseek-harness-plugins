/**
 * "Open with default app", offered inside the preview engine's own
 * unpreviewable empty state.
 *
 * Upstream declares `sidebar.right.tab.document.unpreviewable` — "empty-state
 * contributions for a file this preview cannot render, offered where Retry
 * would stand" — and registers nothing into it. That seam is why the File
 * tab can stop drawing its own external-open footer under a preview the
 * engine already rendered: the offer moves to where the engine says it has
 * nothing to show (an archive, a video, a font), instead of sitting under
 * every previewed file this package happens to classify as external.
 *
 * Exported as a factory rather than a component, because that slot is
 * declared with neither `inject` nor `locale`: a registration into it can
 * pass nothing but the component itself, so the Remote call and the copy
 * have to be closed over at registration time. The owner supplies the
 * file's absolute Host path, which is what the Host opens; nothing here
 * handles paths of its own.
 * @module dsh-plugins-client-ui-conversation-files/ExternalOpenAction
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'

/** What the action closes over. */
export interface ExternalOpenDeps {
  /** Hand the path to the Host's default application for its type. */
  openPath: (path: string) => void
  /** Localized button label, read when the empty state renders. */
  label: () => string
}

/**
 * Build the external-open offer bound to one Client Context's Remote and copy.
 * @param deps - see {@link ExternalOpenDeps}.
 * @returns the component to register into the engine's empty state.
 */
export function createExternalOpenAction(deps: ExternalOpenDeps) {
  return function ExternalOpenAction(
    { absolutePath }: PropsRuntime<'sidebar.right.tab.document.unpreviewable'>,
  ): ReactNode {
    return (
      <Button variant="outline" onClick={() => { deps.openPath(absolutePath) }}>
        {deps.label()}
      </Button>
    )
  }
}
