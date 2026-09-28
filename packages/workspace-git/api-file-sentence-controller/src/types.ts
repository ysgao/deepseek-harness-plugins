/** Wire types for the `fileSentence` Remote namespace. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * One "predict the next sentence/line" request. Carries no workspace
 * identity: unlike `workspace-files`, this namespace never touches the
 * filesystem — `before` is the caller's own in-memory buffer text, already
 * read off whatever file it came from.
 */
export interface FileSentencePredictRequest {
  /** The session whose current model route this request must use — see `controller.ts`'s own doc comment. */
  readonly sessionId: SessionId
  /** Display path of the file being edited, folded into the model's prompt for context only (never read from disk). */
  readonly path: string
  /** shiki/CodeMirror grammar hint for the file, when one resolved; folded into the prompt the same way as `path`. */
  readonly lang?: string
  /** The document text immediately preceding the cursor, already capped by the caller's own local heuristic's pause-point detection. */
  readonly before: string
}
