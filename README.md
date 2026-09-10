# 个人求职工作台（job-search-workbench）

macOS 优先的本地单用户桌面应用：管理岗位、投递流程、面试轮次、Markdown 简历与视觉模板，并通过本机 Codex App Server 完成 JD 分析、公司调研和岗位定向简历生成。

技术实现依据 `docs/` 下的技术方案文档（个人求职工作台-技术实现方案 v1.0.0）。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面宿主 | Tauri 2、Rust stable、Tokio |
| 前端 | React 19、TypeScript 5、Vite、Tailwind CSS 4 |
| 路由 / 状态 | TanStack Router、TanStack Query、Zustand |
| 数据库 | SQLite + SQLx（显式 migrations、WAL、foreign_keys） |
| 类型同步 | Serde / Specta / tauri-specta 生成 TS 绑定（debug 构建时导出 `apps/desktop/src/bindings.ts`） |
| Markdown | unified / remark / rehype（sanitize） |
| 编辑器 | CodeMirror 6（Markdown 模式） |
| 模板 | Handlebars strict mode（无 helper、无脚本） |
| PDF | macOS WKWebView `createPDF`（文字可选择、链接可点击） |
| AI | 本机 `codex app-server`（stdio JSONL，协议类型由 `generate-ts` 生成） |

## 仓库结构

```text
apps/desktop/            # Tauri 桌面应用（React UI + Rust 宿主）
packages/domain/         # TS 类型、Zod schema、岗位状态机
packages/markdown-resume/ # 简历 Markdown 协议解析、渲染、导入归一化
packages/template-engine/ # 模板 manifest 校验与 Handlebars 渲染
packages/app-server-protocol/ # Codex App Server 生成的协议类型与方法名
packages/ui/             # 共享 UI 组件与 tokens
.agents/skills/          # 三个内置 Skill（与打包资源同步）
docs/                    # 方案与 ADR
```

## 快速开始

依赖：Node ≥ 22、pnpm、Rust stable（rustup）、Xcode CLT、macOS。

```bash
pnpm install
pnpm dev            # 前端 dev server（Tauri dev 请用下一行）
pnpm tauri dev      # 完整桌面应用（开发模式）
pnpm test           # 全部 TS 测试
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
pnpm tauri build    # 生成 .app / .dmg（arm64）
```

首次启动会自动：

1. 初始化 `~/Library/Application Support/com.jobdesk.workbench/`（app.db、workspace、templates、backups、logs）。
2. 安装三套内置模板（classic / compact / modern）。
3. 同步三个内置 Skill 到 `workspace/.agents/skills`。
4. 执行 AI 输出崩溃恢复扫描。

## AI 能力（Codex App Server）

- 需要本机安装 `codex-cli`（已验证版本 `0.144.1`，见 `codex-compatibility.json`）。
- 未安装时业务功能不受影响，AI 功能禁用；设置页可发起 ChatGPT 或 API Key 登录。
- 每个 AI Run 使用独立 thread、隔离工作目录（`workspace/ai-runs/<run-id>`）、`workspaceWrite` 沙箱；公司调研开启网络，其余关闭。
- 输出经过 schema / 路径 / 哈希校验后按两阶段提交入库，失败不会污染正式数据。
- 简历优化遵循硬约束：AI 只能重排、压缩、改写既有事实，`unsupportedClaims` 非空时不自动入库。

## 隐私

- 全部数据仅保存在本机；除用户主动运行 AI/调研外不上传任何内容。
- 备份 `.jsw-backup` 不包含 Codex 凭据、API Key、日志与临时 AI Run。
- API Key 仅在内存中存在，发送后立即清空，不落日志不落数据库。

## 测试

- Rust：状态机、原子写入、快照上限、崩溃恢复、migration 幂等、CHECK 约束（`cargo test --lib`）。
- TS：状态机语义、简历协议解析/往返/sanitize、导入归一化、模板 strict 渲染（`pnpm test`）。
- E2E 主链路见方案 §15.4（Playwright 用例在 `apps/desktop/e2e/`，随发布阶段补齐）。

## 许可

MIT。未复制或改造 `JOYCEQL/magic-resume` 的任何源代码、模板或品牌资产。
