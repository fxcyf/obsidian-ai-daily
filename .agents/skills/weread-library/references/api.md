# WeRead API reference

Call `weread_api` with `{ "api_name": "...", "params": { ... } }`.

| Endpoint | Purpose | Important parameters |
|---|---|---|
| `/store/search` | Search books | `keyword`; `scope: 10` for ebooks; `count`, `maxIdx` |
| `/book/info` | Book details | `bookId` |
| `/book/chapterinfo` | Chapter list | `bookId` |
| `/book/getprogress` | Reading progress | `bookId` |
| `/shelf/sync` | User bookshelf | none |
| `/user/notebooks` | Notebook overview | `count`, `lastSort` cursor |
| `/book/bookmarklist` | Personal highlights | `bookId` |
| `/review/list/mine` | Personal notes/reviews | `bookid` (lowercase), `synckey`, `count` |
| `/book/bestbookmarks` | Popular highlights | `bookId`, `chapterUid` (`0` for all) |
| `/book/readreviews` | Thoughts attached to highlights | `bookId`, `chapterUid`, `reviews: [{range}]` |
| `/review/list` | Public reviews | `bookId`, `reviewListType`, `count`, `maxIdx`, `synckey` |
| `/readdata/detail` | Reading statistics | `mode`: `weekly`, `monthly`, `annually`, or `overall`; `baseTime` |
| `/book/recommend` | Personalized recommendations | `count`, `maxIdx` |
| `/book/similar` | Similar books | `bookId`, `count`, `maxIdx`, `sessionId` |

Interpretation rules:

- Reading-time fields are seconds.
- `progress: 1` means 1%, not complete; `100` means complete.
- Review stars use 20-point increments: 20–100 maps to 1–5 stars.
- Paginate `/user/notebooks` with the last item's `sort` as `lastSort` while `hasMore` is true.
- A notebook's personal-note total is `reviewCount + noteCount + bookmarkCount`.
