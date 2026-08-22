# Obsidian Headless 云端 Agent 部署调研

> 调研日期：2026-08-22  
> 状态：调研完成，尚未实施  
> 目标：让移动端 Cortex 不再依赖个人笔记本在线，同时保留 Obsidian Sync、移动端插件 UI 和远程 Agent 能力。

## 1. 结论摘要

官方已经提供 **Obsidian Headless（open beta）**，但它是 Obsidian Sync/Publish 的命令行客户端，不是无界面的 Obsidian 桌面应用。

它可以在云服务器持续同步 Vault，却不会：

- 加载或执行社区插件的 `main.js`
- 提供 `App`、`Vault`、`MetadataCache`、`FileManager` 等 Plugin API runtime
- 启动本项目的 `PluginApiServer`（`127.0.0.1:27080`）
- 运行依赖插件生命周期的后台任务

因此推荐架构不是“让 Cortex 插件运行在 Headless 中”，而是：

1. 手机 Obsidian 继续运行 Cortex 插件及 UI。
2. 云服务器运行 `proxy-server`、Claude Code/Codex 和 MCP Server。
3. MCP Server 直接操作云端 Vault 文件系统。
4. Obsidian Headless 只负责云端 Vault 与 Obsidian Sync 之间的同步。
5. 手机和笔记本继续作为普通 Obsidian Sync 客户端。

本项目已经具备文件系统 fallback。按现有 `PluginApiServer` 的 16 个 endpoint 统计，15 个已有脱离 Obsidian API 的实现；完全缺失的只有文件系统版 `read_image`。主要工作量不在“让它能跑”，而在补齐 Obsidian 语义、同步安全和生产运维。

## 2. 官方产品状态与计划

### 2.1 已确认能力

- Obsidian Headless 当前为 open beta。
- 需要 Node.js 22 或更高版本。
- 使用 Obsidian Sync 需要有效订阅。
- 支持一次性同步和 `ob sync --continuous`。
- 支持 `bidirectional`、`pull-only`、`mirror-remote` 模式。
- 可同步社区插件代码与数据配置，相关类别包括 `community-plugin` 和 `community-plugin-data`。
- 官方明确将其定位为 Sync/Publish 客户端，并列出远程备份、Agent 访问 Vault、团队服务器同步和定时自动化等使用场景。

### 2.2 未承诺能力

截至 2026-08-22，官方没有公开承诺：

- 在 Headless 中支持 Plugin API
- 在 Headless 中加载社区插件
- 提供独立的 Vault REST API
- 提供完整 metadata cache、Bases query 或 Obsidian CLI runtime
- 正式版发布日期、季度目标或退出 beta 的验收条件

公开 roadmap 只把 “Headless client for Sync” 列为已发布，没有 Headless Plugin API 或正式版里程碑。官方论坛管理员也说明：通过 Xvfb 等方式在无图形环境运行完整 GUI 可能可行，但目前不受官方支持。

因此不应让项目计划依赖未来官方 Headless API。应继续保留 backend abstraction；如果将来出现官方 API，只需增加新的 adapter。

### 2.3 当前成熟度信号

调研时 npm 最新版本为 `obsidian-headless@0.0.14`。官方论坛曾提醒 beta 期间预计继续出现 breaking changes；维护者被问及 roadmap 和更新时间时没有给出时间表。

生产部署应固定精确版本，不应自动跟随 `latest`。

## 3. 当前项目架构

现有桌面代理链路为：

```text
移动端 Obsidian
  -> HTTPS
  -> proxy-server
  -> Claude Code / Codex
  -> MCP Server
  -> Plugin API Server (127.0.0.1:27080)
  -> Obsidian Plugin API
```

关键实现：

- `src/main.ts`：仅在 `Platform.isDesktop` 时启动 `PluginApiServer`
- `src/plugin-api-server.ts`：把 Vault、图片、Feed、Podcast 工具包装为 HTTP endpoint
- `mcp-server/src/index.ts`：优先使用 HTTP API，失败时回退到文件系统
- `mcp-server/src/vault-ops.ts`：独立文件系统实现
- `proxy-server/`：移动端到 Claude Code/Codex 的远程代理
- `.github/workflows/deploy.yml`：当前在笔记本 Self-Hosted Runner 构建并复制插件、重启代理

其中 `127.0.0.1:27080` 是本项目自己的 HTTP wrapper，并非 Obsidian 官方 REST API。

## 4. 推荐云端架构

```text
手机 Obsidian
  └─ Cortex 插件 UI
       └─ HTTPS / Tailscale
            └─ 云服务器 proxy-server
                 └─ Claude Code / Codex
                      └─ MCP Server
                           └─ FilesystemBackend
                                └─ 云端 Vault
                                     ↕
                              Obsidian Headless
                                     ↕
                               Obsidian Sync
                              ↙             ↘
                       手机 Obsidian      笔记本 Obsidian
```

建议保持以下 backend 结构：

```text
VaultBackend
├── ObsidianApiBackend       桌面 Obsidian 可用时
├── FilesystemBackend        云端推荐
└── FutureHeadlessBackend    官方未来若提供 API
```

云端不需要运行 Obsidian GUI。移动端插件仍拥有 UI、Workspace、Modal、Notice 和当前笔记上下文；云端只承担 Agent 和 Vault 数据操作。

## 5. 现有 Obsidian API 的替代情况

### 5.1 PluginApiServer endpoint 盘点

| 能力 | 文件系统模式现状 | 主要差距 | 估算 |
|------|------------------|----------|------|
| `read_note` | 已实现 | `cachedRead` 变为直接文件读取 | 0–0.5 人日 |
| `list_notes` | 已实现 | 大 Vault 可增加索引 | 0.5–1 人日 |
| `create_note` | 已实现 | 需原子写入、并发锁 | 1–2 人日 |
| `append_to_note` | 已实现 | 需原子写入、并发锁 | 1–2 人日（与编辑共用） |
| `edit_note` | 已实现 | 需原子写入、并发锁 | 同上 |
| `search_vault` | 已实现基础版 | 标签/YAML 兼容和性能 | 2–4 人日 |
| `update_frontmatter` | 已实现基础版 | 当前 YAML parser 不支持嵌套、多行、注释保留 | 1–2 人日 |
| `delete_note` | 已实现 | `.trash` 同名冲突、与系统回收站语义不同 | 1 人日 |
| `rename_note` | 已实现文件移动 | 不会自动更新引用 | 见下方 |
| `get_links` | 已实现基础版 | 路径消歧、Markdown link、heading/block/embed 不完整 | 3–10 人日 |
| `read_image` | 未实现 | 需 Node 二进制读取和压缩 | 1–2 人日 |
| Podcast 3 个 endpoint | 已有独立 Node 实现 | 无 Obsidian API 依赖 | 0 |
| Feed 2 个 endpoint | 已有独立 Node 实现 | 无 Obsidian API 依赖 | 0 |

### 5.2 Frontmatter

当前文件系统 parser 只覆盖简单字符串、数字、布尔值和数组。建议使用 `yaml` 的 Document API，以支持：

- 嵌套对象与数组
- 多行字符串
- YAML 日期、null、引号与转义
- 尽可能保留注释和原始结构

### 5.3 双链索引

当前实现通过正则扫描 `[[link]]`，不能完整复刻 `metadataCache.resolvedLinks`。可靠版本至少需要：

- 解析 Wikilink、Markdown link 和 embed
- 支持 alias、`#heading`、`^block-id`
- 支持相对路径、完整路径和同名文件消歧
- 使用文件 watcher 增量维护 link graph，避免每次全库扫描

覆盖当前 Agent 的常用场景约 3–5 人日；高度接近 Obsidian 语义约 1–2 周。

### 5.4 重命名后更新链接

`app.fileManager.renameFile()` 的核心价值是重命名后更新内部链接。自行实现需要：

- 找到所有指向源文件的引用
- 重写 Wikilink、Markdown link、embed
- 保留 heading、block reference 和 alias
- 遵循相对路径/最短路径策略
- 处理同名文件消歧
- 事务式写入并保留 undo journal

覆盖常见场景约 4–7 人日；接近 Obsidian 行为约 2–3 周。不建议追求所有边界条件完全一致。

### 5.5 图片

文件系统模式可以使用 `fs.readFile` + MIME 检测 + `sharp` 代替 Obsidian `readBinary` 和浏览器 Canvas，继续执行尺寸限制、压缩和 base64 输出。

### 5.6 文件事件和自动标注

`app.vault.on("create"/"modify")` 可用 `chokidar` 替代，并增加：

- debounce
- 忽略 Agent 自身的重复写入
- 防止标注循环
- Headless Sync 批量落盘时的事件合并

预计 2–4 人日。

### 5.7 不应在云端复刻的能力

以下能力继续由手机/桌面插件承担：

- Workspace、ItemView、Modal、Notice
- 当前活动笔记、打开链接和编辑器交互
- 插件设置 UI
- 移动端布局和渲染

## 6. 实施工作量

以一名熟悉本仓库的 TypeScript 开发者、包含测试和基本生产加固估算：

| 目标 | 工作量 |
|------|--------|
| 让现有 Agent 使用云端文件系统 Vault | 已基本具备 |
| 补齐图片、完整 YAML、原子写入和路径安全 | 3–5 人日 |
| 加可靠 link index、文件 watcher | 5–10 人日 |
| 加重命名自动更新链接 | 4–10 人日 |
| 云端 systemd、Headless Sync、监控、备份 | 3–5 人日 |
| 稳定生产版本 | 合计约 3–5 周 |
| 复刻完整 Obsidian Plugin API | 数月以上，不建议 |

推荐分期：

1. **MVP**：显式使用 `FilesystemBackend`，部署云端 proxy/MCP/Headless，保留 Agent 删除和重命名禁用。
2. **数据安全**：原子写入、per-file lock、完整 YAML、图片、undo journal。
3. **知识图谱**：link index、可靠 backlinks/outlinks。
4. **受控重命名**：在完整备份和测试下启用引用更新。
5. **后台自动化**：文件 watcher、自动标注和定时任务。

## 7. Headless Sync 故障模型

Headless 是 Obsidian Sync 的一个普通客户端，不是只读缓存。不同故障的影响不同：

| 故障 | 云端 | 其他设备 |
|------|------|----------|
| 进程退出、断网、登录失效 | 云端副本停留在旧版本 | 手机和笔记本通常继续独立同步 |
| `--continuous` 卡住 | Agent 读写旧副本，修改暂不上传 | 通常不受影响 |
| 云端和手机并发修改同一 Markdown | 发生冲突 | 可能自动 merge、重复文本或产生 conflict copy |
| 云端上传旧文件/空文件 | 错误版本进入远端 | 会传播到其他设备 |
| 云端把文件误判为删除 | 删除记录进入远端 | 可能传播到所有设备 |
| 云服务器被入侵 | 攻击者可修改 Vault | 恶意修改可通过 Sync 传播 |

公开 beta 曾有以下风险报告：

- 空目录接入后开始删除远端笔记（issue #19）
- 定期误删文件（issue #28）
- 修改同步范围后删除远端文件（issue #38，已关闭）
- 并发编辑丢失一方修改且版本历史无记录（issue #42，已关闭）
- 重启后 `--continuous` 卡在 Connecting 且进程仍存活（issue #50）

部分问题来自旧版本或已经关闭，不能据此断言当前版本必然复现；但足以说明必须把 Headless 当作可能影响整个远端 Vault 的写客户端。

## 8. 备份与恢复

Obsidian Sync version history 是第一层恢复手段，但不是独立备份：

- Standard 的 Markdown 历史保留 1 个月
- Plus 的 Markdown 历史保留 12 个月
- 附件旧版本只保留 2 周
- 已删除/重命名笔记可以恢复，也支持批量恢复删除文件
- 配置文件有 Settings version history
- 重建或删除 remote vault 会丢失相关历史
- 某些并发丢失可能没有进入 version history

最低备份要求：

- 每小时：云盘、ZFS 或 Btrfs 快照，保留 7 天
- 每天：Restic/Borg 加密备份到另一家对象存储，保留 30–90 天
- 每次升级 Headless、修改同步配置或部署插件前：手动快照
- 每月：恢复到临时目录并验证 Markdown、附件和 `.obsidian`

备份必须位于 Vault 外部和另一个故障域。同步副本不等于备份；Agent/Headless 进程也不应拥有删除历史备份的权限。

## 9. 安全上线流程

1. 从已确认正确的客户端导出完整 Vault 备份。
2. 云端使用全新、明确的 Vault 目录；不要复用可能包含残留状态的目录。
3. 安装并固定精确的 Headless 版本，禁止自动跟随 `latest`。
4. 初始阶段使用 `pull-only` 和一次性 `ob sync`。
5. 比较文件数量、总大小和关键目录，抽查重要笔记及附件。
6. 为完整云端副本创建快照。
7. 只有 Agent 确实需要写回时，才切换到 `bidirectional`。
8. 每次运行 `ob sync-config` 后检查 Vault ID、路径、mode、file types、configs 和 excluded folders。
9. 初期可用 systemd timer 每 1–5 分钟执行一次同步并设置超时；稳定后再评估 continuous。
10. 监控日志中的 `Fully synced` 心跳；进程存活不代表同步健康。
11. 保持 Codex/Claude 的删除、重命名和 Shell 写入权限最小化。
12. 定期执行恢复演练。

官方明确警告：不要在同一设备的同一 Vault 上同时使用桌面 Obsidian Sync 和 Headless Sync。云服务器只运行其中一种同步方式；笔记本作为另一台设备使用桌面 Sync 不受此限制。

## 10. GitHub Actions 迁移

现有 Self-Hosted Runner 可以迁移到云服务器，或改为 GitHub Hosted Runner 构建后通过 SSH 部署。

云端部署流程建议为：

1. Checkout 并构建插件、MCP Server、Proxy Server。
2. 将插件产物复制到云端 Vault 的 `.obsidian/plugins/ai-daily-chat/`。
3. 由 Headless Sync 将社区插件文件同步到远端。
4. 重建并重启 `proxy-server`。
5. 验证 proxy health、MCP filesystem backend 和最新同步心跳。

现有 workflow 和 systemd unit 包含笔记本专属的硬编码路径，需要参数化。当前 service 文件还包含明文认证 token，迁移前必须轮换，并改为权限受控的 `EnvironmentFile` 或部署 secret，不能继续把凭据提交到仓库。

移动端收到新插件文件后通常仍需 reload、重启或强制退出 Obsidian 才会加载新版本；Obsidian Sync 不保证社区插件热重载。

## 11. 建议决策

推荐采用“Headless Sync + 独立 FilesystemBackend”的云端架构，但分阶段上线：

- 不等待尚无时间表的正式版或 Headless Plugin API。
- 第一阶段禁用 Agent 删除和重命名，只开放读、创建、追加、编辑和 frontmatter。
- 在可靠备份、监控和恢复演练完成后，再逐步启用复杂写操作。
- 固定 Headless 版本，所有升级先在 Vault 副本和 `pull-only` 模式验证。
- 保留 `ObsidianApiBackend`，让桌面端可继续使用完整 Obsidian 语义。

如果必须在云端使用完整 Plugin API，唯一现实替代是运行完整 Obsidian GUI + Xvfb/虚拟桌面；该方案目前不受官方支持，Electron 生命周期、GPU、singleton lock 和自动升级都增加运维复杂度，不建议作为主要生产架构。

## 12. 参考资料

- [Obsidian Headless](https://obsidian.md/help/headless)
- [Headless Sync](https://obsidian.md/help/sync/headless)
- [Obsidian Roadmap](https://obsidian.md/roadmap)
- [obsidian-headless GitHub](https://github.com/obsidianmd/obsidian-headless)
- [维护者关于计划和更新时间的回复](https://github.com/obsidianmd/obsidian-headless/issues/29)
- [完整无 GUI Obsidian 功能请求](https://forum.obsidian.md/t/a-complete-terminal-based-version-of-obsidian-headless-no-gui/111137)
- [官方关于 Xvfb 方案不受支持的说明](https://forum.obsidian.md/t/a-complete-terminal-based-version-of-obsidian-headless-no-gui/111137/12)
- [Obsidian Sync Version history](https://obsidian.md/help/sync/version-history)
- [Obsidian Sync conflict troubleshooting](https://obsidian.md/help/sync/troubleshoot)
- [Headless issue #19](https://github.com/obsidianmd/obsidian-headless/issues/19)
- [Headless issue #28](https://github.com/obsidianmd/obsidian-headless/issues/28)
- [Headless issue #38](https://github.com/obsidianmd/obsidian-headless/issues/38)
- [Headless issue #42](https://github.com/obsidianmd/obsidian-headless/issues/42)
- [Headless issue #50](https://github.com/obsidianmd/obsidian-headless/issues/50)

