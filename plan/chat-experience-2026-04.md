# Chat experience feature (2026-04)

## Workflow

- Implemented on branch `task-chat-experience`, merged to `main` as `fc03352`.
- Streaming uses global `fetch`; non-streaming and summarize calls use `requestUrl` (CORS-safe in Obsidian).

## Pitfalls

- **Duplicate user messages**: Calling `setHistoryFromStrings` from the same turns that `chat()` will push duplicates the latest user line. Only hydrate client history when restoring a saved session, not on every `initClient`.
- **Tool + stream**: Reset stream buffer per API round, but pass `priorAssistantText + roundStream` to the UI so multi-step tool loops read as one continuous assistant reply.
