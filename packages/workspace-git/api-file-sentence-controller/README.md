# dsh-plugins-api-file-sentence-controller

A Host Typert controller (own `TypertRemoteService`, auto-discovered by
`@deepseek-ai/dsh-typert-loader`) owning the `fileSentence` Remote namespace:
one auxiliary model call predicting the sentence or line that follows the
text the File editor's ghost text (`dsh-plugins-client-ui-file-editing`'s
`sentenceGhostText`) is showing a suggestion for.

## The route is the calling Session's own current model

This is not a separately configured provider/model. `predict()` reads
`session.requestHeader()?.config` — the exact route the calling Session's own
conversation is currently on, the same "current session route" fold
`@deepseek-ai/dsh-session-title-llm` reads for its own auxiliary title calls.
A session with no logged request yet (nothing sent in this conversation)
has no route to read, and `predict()` answers `null` rather than falling
back to any other model: the feature is "reuse the model this conversation
already trusts," never a second, independently-configured AI integration.

No workspace identity is involved anywhere in this namespace: `before` is
the caller's own in-memory buffer text (already read off whichever file it
came from), so nothing here ever touches the filesystem, and this package
has no dependency on `dsh-plugins-api-workspace-file-controller` or
`-git-controller`.

## Failure posture

Every failure mode — no session, no route yet, blank input, a provider
error, a timeout, a non-`stop` finish reason, or the model producing no
usable text — degrades identically to `predict()` resolving `null`. This
is a best-effort editing aid layered over a heuristic that already works
without it (see `dsh-plugins-client-ui-file-editing`'s own
`sentencePrediction.ts`), never a required operation, so nothing here ever
throws a user-visible error for an unavailable route or a declining model.

## Auditability

Every dispatched request appends a log-only `workspace-git/file-sentence-
request` Session event (path, resolved route, and input length) before the
model call — the `Model-visible ⟺ logged` invariant `@deepseek-ai/dsh-llm`
callers keep, mirroring `dsh-session-title-llm`'s own `session/title-llm-
request` record. The event carries no buffer text itself, only its length;
the exact text sent is optionally visible through the model request itself,
not duplicated into the log.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxInputChars` | 4000 | UTF-16 character cap on the buffer text sent, tail-truncated (the text closest to the cursor matters most) |
| `maxOutputTokens` | 60 | Output cap — a sentence/line, never a paragraph |
| `timeoutMs` | 8000 | End-to-end auxiliary request deadline |

See [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) for the full plugin
inventory and rationale.
