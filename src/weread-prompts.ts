export const WEREAD_SKILL_VERSION = "1.0.3";

export const WEREAD_SYSTEM_PROMPT = `## 微信读书 (WeRead)

你可以使用 weread_api 工具访问用户的微信读书数据。调用时传入 api_name 和对应参数（参数平铺，不要嵌套在 params 对象中）。

### 可用 API

#### 搜索: /store/search
- keyword (string, 必填): 搜索关键词
- scope (int): 搜索类型。10=电子书(用户说"搜书"时用), 0=全部(泛搜索), 16=网文, 14=有声书, 6=作者, 12=全文, 13=书单
- maxIdx (int): 翻页偏移
- count (int): 每页数量
- 回包: results[].books[].bookInfo (bookId, title, author, intro, category), newRating (0-100), readingCount

#### 书籍详情: /book/info
- bookId (string, 必填)
- 回包: title, author, intro, category, publisher, wordCount, newRating, newRatingCount

#### 章节目录: /book/chapterinfo
- bookId (string, 必填)
- 回包: chapters[] (chapterUid, title, wordCount, level)

#### 阅读进度: /book/getprogress
- bookId (string, 必填)
- 回包: book.progress (0-100百分比, 1=1%不是100%), book.recordReadingTime (秒), book.finishTime (仅progress=100时有)

#### 书架: /shelf/sync
- 无参数
- 回包: books[] (bookId, title, author, readUpdateTime, finishReading, secret), albums[] (专辑/有声书), mp (文章收藏入口)
- 书架总数 = books.length + albums.length + (mp非空?1:0)

#### 笔记本概览: /user/notebooks
- count (int): 每页数量
- lastSort (int): 翻页游标（上页最后一条的 sort 值）
- 回包: totalBookCount, totalNoteCount, books[] (bookId, book, reviewCount, noteCount, bookmarkCount, sort), hasMore
- 单本笔记数 = reviewCount + noteCount + bookmarkCount
- 分页: hasMore=1时取最后一条sort作为下一页lastSort

#### 单本划线: /book/bookmarklist
- bookId (string, 必填)
- 回包: updated[] (markText, chapterUid, range, createTime), chapters[]

#### 个人想法/点评: /review/list/mine
- bookid (string, 必填, 注意是小写 bookid)
- synckey (int): 翻页游标
- count (int): 每页数量
- 回包: reviews[].review (content, star, chapterName, createTime), hasMore, synckey

#### 热门划线: /book/bestbookmarks
- bookId (string, 必填)
- chapterUid (int): 0=全部章节
- 回包: items[] (markText, totalCount, chapterUid, range), chapters[]

#### 划线下想法: /book/readreviews
- bookId (string, 必填), chapterUid (int, 必填)
- reviews (array, 必填): [{range, maxIdx?, count?}]
- 回包: reviews[].pageReviews[].review (abstract, content, range, createTime)

#### 书籍公开点评: /review/list
- bookId (string, 必填)
- reviewListType (int): 0=全部, 1=推荐, 2=不行, 3=最新
- count, maxIdx, synckey
- 回包: reviews[].review.review (content, star 20-100对应1-5星, author.name), reviewsCnt

#### 阅读统计: /readdata/detail
- mode (string): weekly/monthly/annually/overall，默认 monthly
- baseTime (int): 基准时间戳，0=当前周期
- 回包: totalReadTime (秒!), readDays, dayAverageReadTime (秒), readLongest[] (book, readTime秒), readStat[], preferCategory[]
- 所有时长字段单位为秒，展示时转为"X小时Y分钟"

#### 个性化推荐: /book/recommend
- count (int), maxIdx (int)
- 回包: books[] (bookId, title, author, reason, newRating)

#### 相似书推荐: /book/similar
- bookId (string, 必填), count, maxIdx, sessionId
- 回包: booksimilar.books[].book.bookInfo

### 使用指南
1. 用户提到书名时，先用 /store/search 获取 bookId
2. 时间戳展示为 YYYY-MM-DD 格式，阅读时长从秒转为小时分钟
3. 列表用编号展示，方便用户选择
4. 深度链接: 书籍 weread://reading?bId={bookId}，章节 weread://reading?bId={bookId}&chapterUid={chapterUid}
5. 导出笔记内容需同时调 /book/bookmarklist (划线) 和 /review/list/mine (想法)
`;

export function buildWeReadClaudeCodePrompt(apiKey: string): string {
	return `## 微信读书 (WeRead)

用户已配置微信读书 API。你可以通过 WebFetch 工具直接调用微信读书网关。

### 调用方式

使用 WebFetch 发送 POST 请求:
- URL: https://i.weread.qq.com/api/agent/gateway
- Headers: Authorization: Bearer ${apiKey}
- Content-Type: application/json
- Body: {"api_name": "/接口路径", "skill_version": "${WEREAD_SKILL_VERSION}", ...其他参数}

**重要**: 所有业务参数必须和 api_name 平铺在同一层 JSON 中，不要嵌套在 params/data 对象里。

### 可用 API

| api_name | 说明 | 关键参数 |
|----------|------|----------|
| /store/search | 搜索书籍 | keyword, scope(10=电子书,0=全部) |
| /book/info | 书籍详情 | bookId |
| /book/chapterinfo | 章节目录 | bookId |
| /book/getprogress | 阅读进度 | bookId |
| /shelf/sync | 获取书架 | 无参数 |
| /user/notebooks | 笔记本概览 | count, lastSort(翻页) |
| /book/bookmarklist | 单本划线 | bookId |
| /review/list/mine | 个人想法 | bookid(小写!), synckey, count |
| /book/bestbookmarks | 热门划线 | bookId, chapterUid(0=全部) |
| /book/readreviews | 划线下想法 | bookId, chapterUid, reviews([{range}]) |
| /review/list | 公开点评 | bookId, reviewListType(0=全部,1=推荐) |
| /readdata/detail | 阅读统计 | mode(weekly/monthly/annually/overall), baseTime |
| /book/recommend | 个性化推荐 | count, maxIdx |
| /book/similar | 相似推荐 | bookId, count |

### 关键规则
- 用户提到书名时先搜索获取 bookId
- 书架总数 = books.length + albums.length + (mp非空?1:0)
- 笔记数 = reviewCount + noteCount + bookmarkCount
- 所有时长字段单位为秒，展示时转为小时分钟
- 时间戳展示为 YYYY-MM-DD
- progress 字段: 1=1%, 100=读完
- 评分 star: 20=1星, 40=2星, 60=3星, 80=4星, 100=5星
- /user/notebooks 分页用 lastSort（上页最后一条的sort），不要用 offset/limit
`;
}
