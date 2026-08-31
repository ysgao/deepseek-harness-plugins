# dsh-plugins-client-ui-conversation-files

**Status: Phase 0 scaffold — not yet implemented.**

The File tab in the conversation view: in-app file preview, edit, and
side-by-side git diff for a session's opened workspace paths.

In `yga/deepseek-harness` this was already a clean, separate package
(`@deepseek-ai/dsh-client-ui-conversation-files`) — of the two features,
this piece already followed the plugin pattern. Ported near as-is, repointed
at `dsh-plugins-client-ui-file-editing` instead of the shared
`@deepseek-ai/dsh-client-ui-primitives`.
