---
name: weread-library
description: Access and analyze the user's WeRead (微信读书) library, books, reading progress, highlights, notes, reviews, recommendations, and reading statistics. Use for requests about 微信读书、书架、读书笔记、划线、想法、阅读时长、书籍搜索 or personalized book recommendations. Do not use for unrelated web book searches.
---

# WeRead Library

Use the `weread_api` tool from the `obsidian_vault` MCP server. Read [references/api.md](references/api.md) when selecting an endpoint or interpreting its response.

## Workflow

1. Identify the requested book or account-level operation.
2. When the user supplies a book title instead of a `bookId`, call `/store/search` first with `scope: 10`.
3. Call the narrowest endpoint that answers the request. Follow pagination fields returned by the API rather than inventing offsets.
4. For a complete personal-note export, combine `/book/bookmarklist` with `/review/list/mine`.
5. Convert timestamps to `YYYY-MM-DD`, durations from seconds to hours/minutes, and progress to a percentage.
6. Present lists with stable numbering and include `weread://reading?bId={bookId}` links when useful.

## Guardrails

- Treat library, highlights, notes, reviews, and reading statistics as private user data.
- Do not claim the tool is unavailable until checking for `weread_api` in `obsidian_vault`.
- If the tool is absent, report that WeRead must be enabled and its API key configured in Cortex settings.
- Do not expose the API key in output, logs, notes, or tool arguments.
