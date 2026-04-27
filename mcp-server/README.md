# Obsidian Vault MCP Server

用于 Claude Code 的 Obsidian 知识库 MCP 工具服务器。让 Claude Code 直接操作你的 Obsidian vault 文件。

## 安装

```bash
cd mcp-server
npm install
npm run build
```

## 配置 Claude Code

在 Claude Code 中运行：

```bash
claude mcp add obsidian-vault -e VAULT_PATH=/path/to/your/vault -e KNOWLEDGE_FOLDERS=Raw,Wiki -- node /path/to/obsidian-ai-daily/mcp-server/dist/index.js
```

或手动编辑 `~/.claude.json`，在 `mcpServers` 中添加：

```json
{
  "obsidian-vault": {
    "command": "node",
    "args": ["/path/to/obsidian-ai-daily/mcp-server/dist/index.js"],
    "env": {
      "VAULT_PATH": "/path/to/your/vault",
      "KNOWLEDGE_FOLDERS": "Raw,Wiki"
    }
  }
}
```

将路径替换为你的实际路径。

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `VAULT_PATH` | 是 | Obsidian vault 根目录的绝对路径 |
| `KNOWLEDGE_FOLDERS` | 否 | 知识库文件夹，逗号分隔（默认 `Raw,Wiki`） |

## 提供的工具

| 工具 | 说明 |
|------|------|
| `read_note` | 读取笔记全文 |
| `search_vault` | 全文搜索，支持文件夹和标签过滤 |
| `list_notes` | 列出文件夹中的笔记 |
| `create_note` | 创建新笔记（支持 frontmatter） |
| `edit_note` | 编辑笔记（search_replace / heading / line_range） |
| `append_to_note` | 追加内容到笔记末尾 |
| `rename_note` | 重命名/移动笔记 |
| `delete_note` | 删除笔记（两步确认，移到 .trash） |
| `get_links` | 获取双向链接关系 |
| `update_frontmatter` | 修改 YAML frontmatter |

## 使用示例

配置完成后，在 Claude Code 中可以直接说：

- "帮我整理 Raw/ 里的未整理笔记到 Wiki/"
- "搜索知识库中关于 RAG 的笔记"
- "列出最近修改的 10 篇 Wiki 条目"

## 开发

```bash
npm run dev    # watch 模式编译
npm test       # 运行测试
```
