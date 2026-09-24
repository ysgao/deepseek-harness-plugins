/**
 * The "show me the files" request, and how a keyboard command reaches a tree
 * that keeps its own expansion in component state.
 *
 * `FilesNode` is deliberately store-less — local state, no persistence, one
 * instance per Workspace group (see its own doc comment). That is the right
 * shape for a row nobody addresses from outside, and it stops being the right
 * shape the moment a shortcut has to open it. Rather than give the tree a
 * store it needs for nothing else, this is the smallest thing that closes the
 * gap: a broadcast with no payload, requested by the command and observed by
 * every mounted tree.
 *
 * Every mounted tree answers, not one: a request carries no Workspace,
 * because the only place the "current" Workspace is known is inside
 * `dsh-client-ui-workspace`'s own navigation service, and reaching into that
 * to aim a keystroke would couple this package to a replaced package's
 * internals to save a reader one glance. What the reader sees instead is
 * every Files row expanded and the first one focused — which is where the
 * keystroke was taking them anyway.
 * @module dsh-plugins-client-ui-workspace-files/reveal
 */

/** Broadcast requesting that every mounted Files tree show itself. */
export interface FilesReveal {
  /** Ask every mounted tree to expand; the first to answer takes focus. */
  request: () => void
  /**
   * Observe reveal requests for a component's lifetime.
   * @param listener - called once per request.
   * @returns its disposer.
   */
  subscribe: (listener: () => void) => () => void
}

/**
 * Create one reveal broadcast.
 * @returns the request/subscribe pair, shared by the command and the trees.
 */
export function createFilesReveal(): FilesReveal {
  const listeners = new Set<() => void>()
  return {
    request: () => {
      // A listener that throws is a bug in one tree, not a reason for the
      // keystroke to fail for the others.
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch (error: unknown) {
          console.error('workspace-files: reveal listener failed', error)
        }
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
