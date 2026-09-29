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

## No Session event — and why one must not be added back

A dispatch here writes nothing to the Session log. Two independent reasons,
either one sufficient.

**It is not conversation content.** Sentence prediction and autocompletion
belong to the File editor: the suggestion is drawn in that buffer, accepted
or dropped by the next keystroke, and never reaches the conversation's
derived message history. The Session is consulted for exactly one fact — the
route this conversation is already on — which does not make an editor
keystroke part of the conversation's record.

**And the log physically cannot carry it.** Unlike
`dsh-session-title-llm`'s `session/title-llm-request` record for the
equivalent auxiliary call, an out-of-tree plugin has no admissible event type
to write:

`KNOWN_SESSION_EVENT_TYPES` is generated from the harness repository's own
`SessionEventMap`, so any type an out-of-tree plugin declares is unknown to
every reader by construction. On reload, `validateStoredEvents` refuses the
entire stored log rather than skipping the record — unless the persisted
envelope carries `ignorable: true`, and `Session.append()` has no parameter
that sets it (its sole options argument is `SurfaceIntent`, for surface
events). A declaration-merged event type therefore typechecks, writes
happily, and makes the conversation unloadable from the next launch on:

```
Failed to load history: … contains event type
"workspace-git/file-sentence-request" (seq 95) unknown to this harness and
not marked ignorable; refusing to interpret the log
```

Version 0.0.0 of this package did exactly that. The event was removed, and
`pnpm run repair:sessions` retrofits `ignorable: true` onto the records
already written by that build — see
[`scripts/repair-session-logs.mjs`](../../../scripts/repair-session-logs.mjs).

`Model-visible ⟺ logged` is satisfied: nothing this namespace sends or
receives becomes a model-visible input to the conversation, so the
conversation log stays a complete account of itself.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxInputChars` | 4000 | UTF-16 character cap on the buffer text sent, tail-truncated (the text closest to the cursor matters most) |
| `maxOutputTokens` | 60 | Output cap — a sentence/line, never a paragraph |
| `timeoutMs` | 8000 | End-to-end auxiliary request deadline |

See [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) for the full plugin
inventory and rationale.
