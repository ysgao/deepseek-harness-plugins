/**
 * Host owner of the `fileSentence` Remote namespace: one auxiliary
 * model-backed "predict the next sentence or line" call for the File
 * editor's ghost-text feature (`dsh-plugins-client-ui-file-editing`'s
 * `sentenceGhostText`).
 *
 * The route is never a separately configured provider/model — it is the
 * exact route the calling Session is *currently* using: `session.
 * requestHeader()?.config`, the same "current session route" fold
 * `@deepseek-ai/dsh-session-title-llm` reads for its own auxiliary title
 * calls (see that package's `resolveRoute`). A session that has not yet
 * sent a single message has no logged route yet, and this namespace simply
 * answers `null` rather than falling back to any other default — the
 * feature is "reuse the model already trusted for this conversation," not
 * "call some other model behind the user's back."
 *
 * Mounted as an independent top-level plugin — no edit to any vendored
 * controller, and no dependency on `dsh-plugins-api-workspace-file-
 * controller`/`-git-controller`: this namespace never reads or writes a
 * file, so it needs no workspace identity at all, only the calling
 * Session's own id.
 * @module dsh-plugins-api-file-sentence-controller/controller
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-session'
import type { ContextFormed, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { FileSentencePredictRequest } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `fileSentence` Remote namespace. */
    fileSentenceController: FileSentenceController
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-plugins-api-file-sentence-controller': { kind: 'dsh-plugins-api-file-sentence-controller' } & ContextFormed
  }
}

/** Exact route and input size recorded before one auxiliary ghost-text dispatch — the "Model-visible ⟺ logged" record this namespace's own request needs, mirroring `dsh-session-title-llm`'s `session/title-llm-request`. */
export interface FileSentenceRequestEventData {
  /** Display path the prediction was requested for. */
  readonly path: string
  /** Grammar hint, when the caller resolved one. */
  readonly lang?: string
  /** Exact provider/model route used, read from the session's own current header. */
  readonly route: { readonly provider: string; readonly model: string }
  /** UTF-16 length of the (possibly truncated) input actually sent. */
  readonly inputChars: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Log-only pre-dispatch record of one ghost-text auxiliary model request. */
    'workspace-git/file-sentence-request': FileSentenceRequestEventData
  }
}

/** Deployment policy for the auxiliary ghost-text call. */
export interface Config {
  /** Maximum UTF-16 characters of buffer text sent as input, tail-truncated. */
  readonly maxInputChars?: number
  /** Output token cap — a sentence/line, never a paragraph. */
  readonly maxOutputTokens?: number
  /** End-to-end auxiliary request deadline in milliseconds. */
  readonly timeoutMs?: number
}

const DEFAULT_MAX_INPUT_CHARS = 4000
const DEFAULT_MAX_OUTPUT_TOKENS = 60
const DEFAULT_TIMEOUT_MS = 8000

/** Capability-owned timeout reason code for the auxiliary ghost-text request. */
export const FILE_SENTENCE_TIMEOUT_CODE = 'FILE_SENTENCE_TIMEOUT'

/** Stable system instruction: predict a continuation, or nothing, never an explanation. */
function systemPrompt(): string {
  return [
    'You complete a writer\'s next sentence or short line inside a text/code editor.',
    'You are given the text immediately preceding the cursor in one file.',
    'Reply with ONLY the text that most plausibly continues it — one sentence, or one short line for a list/log/config style file — matching its language, tone, and formatting exactly.',
    'Never repeat any part of the given text. Never add an explanation, a label, quotes, or Markdown fencing.',
    'If no continuation is clearly implied, reply with nothing at all.',
  ].join('\n')
}

/** Translate a non-`stop` finish into "no usable suggestion" — this namespace never surfaces a model failure to the editor, it degrades to no suggestion (see the controller's own doc comment). */
function isUsableStop(finish: { kind: string }): boolean {
  return finish.kind === 'stop'
}

export class FileSentenceController extends TypertRemoteService {
  static inject = ['llm', 'sessions']

  static Config: z<Config> = z.object({
    maxInputChars: z.natural().default(DEFAULT_MAX_INPUT_CHARS),
    maxOutputTokens: z.natural().default(DEFAULT_MAX_OUTPUT_TOKENS),
    timeoutMs: z.natural().default(DEFAULT_TIMEOUT_MS),
  })

  private readonly maxInputChars: number
  private readonly maxOutputTokens: number
  private readonly timeoutMs: number

  /**
   * @param ctx - Host context carrying the LLM runtime and the Session store.
   * @param config - input/output/timeout bounds for the auxiliary call.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'fileSentenceController', { namespace: 'fileSentence' })
    this.maxInputChars = config.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS
    this.maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /**
   * Predict the sentence/line that follows `request.before`, using the
   * exact provider/model the calling Session is currently on.
   * @param request - session identity, display context, and buffer text preceding the cursor.
   * @param signal - caller cancellation (aborted by the editor the moment a later keystroke supersedes this attempt).
   * @returns the predicted continuation, or `null` when the session has no
   * current route yet, the input is blank, the call fails or times out, or
   * the model itself declines to continue — every one of these degrades to
   * "no suggestion" identically, never a thrown error, since this is a
   * best-effort editing aid, not a required operation.
   */
  @Remote('predict')
  async predict(request: FileSentencePredictRequest, signal: AbortSignal): Promise<string | null> {
    const session = this.ctx.sessions.get(request.sessionId)
    if (session === undefined) return null
    const route = session.requestHeader()?.config
    if (route === undefined) return null
    const before = request.before.length > this.maxInputChars
      ? request.before.slice(request.before.length - this.maxInputChars)
      : request.before
    if (before.trim().length === 0) return null

    using callDeadline = deadline(signal, this.timeoutMs, FILE_SENTENCE_TIMEOUT_CODE)
    const header = request.lang === undefined ? `File: ${request.path}` : `File: ${request.path} (${request.lang})`
    const messages: Message[] = [createUserMessage({
      content: [{ type: 'text', text: `${header}\n---\n${before}` }],
      source: { kind: 'dsh-plugins-api-file-sentence-controller' },
    })]
    const options: GenerateOptions = deepFreeze({
      provider: route.provider,
      model: route.model,
      messages,
      system: systemPrompt(),
      maxTokens: this.maxOutputTokens,
      sessionId: request.sessionId,
      signal: callDeadline.signal,
    })

    session.append('workspace-git/file-sentence-request', {
      path: request.path,
      ...(request.lang === undefined ? {} : { lang: request.lang }),
      route: { provider: route.provider, model: route.model },
      inputChars: before.length,
    })

    const assembler = new BlockAssembler()
    try {
      for await (const chunk of this.ctx.llm.stream(options)) {
        callDeadline.signal.throwIfAborted()
        assembler.push(chunk)
      }
    } catch {
      return null
    }
    if (!isUsableStop(assembler.finish)) return null
    const blocks = assembler.blocks()
    if (blocks.some(block => block.type === 'tool-call')) return null
    const text = blocks
      .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join(' ')
      .trim()
    return text.length === 0 ? null : text
  }
}

export default FileSentenceController
