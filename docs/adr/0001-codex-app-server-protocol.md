# ADR-0001：Codex App Server 协议以 0.144.1 生成物为准

状态：已接受（2026-09-11）

## 背景

技术方案 §10.1 要求 App Server 的 wire type 只能来自 `codex app-server generate-ts` 生成物，
并规定运行时版本校验。实际接入验证（0.144.1）发现方案文档与生成物存在差异。

## 决策

1. 协议类型提交在 `packages/app-server-protocol/generated/`（含 v2 目录），由 CI 以
   `codex-cli 0.144.1` 重新生成；禁止手写。
2. 以下差异以生成物/实测为准，并回写方案：
   - approval policy 的取值是 `"untrusted"`（方案示例中的 `unlessTrusted` 不存在）。
   - 登录方法为 `account/login/start`（类型 `chatgpt` / `apiKey` / `chatgptDeviceCode`），
     登录态检测优先使用 `account/read`；注意该调用可能阻塞较久，客户端必须设置超时。
   - turn 取消使用 `turn/interrupt`，参数为 `{ threadId, turnId }`。
   - `skills/config/write` 的选择器为 `{ path | name, enabled }`。
3. stdio 通道必须保持打开：stdin EOF 会导致服务器停止派发后续请求（实测结论）。

## 2026-09-14 补记：thread/turn 线格式（实测）

- `thread/start` 的 `sandbox` 是**字符串枚举**（`"read-only" | "workspace-write" | "danger-full-access"`），
  传对象会被拒：`invalid value: map, expected map with a single key`；可写根默认即 `cwd`。
- 细粒度沙箱（`writableRoots`/`networkAccess`/`excludeTmpdirEnvVar`/`excludeSlashTmp`）放在
  **`turn/start` 的 `sandboxPolicy`**（SandboxPolicy 富对象）。
- `turn/start` 的 `input[].text_elements` 为必填（可为空数组）。
- thread 不跨进程：thread/start 与 turn/start 必须同一 app-server 会话。
- 端到端验证脚本思路：stdio 驱动 initialize → thread/start → turn/start → 等 `turn/completed`。

## 2026-09-14 补记：审批策略与通知直连

- `approvalPolicy: "untrusted"` 下，服务端对模型请求发出的审批是 **server request**，
  客户端必须应答；审批 UI 未实现时会死锁（实测：turn 挂满 10 分钟超时、outputs 零产出）。
  在审批 UI 落地前改用 **`"never"` + workspace-write 沙箱**：沙箱把写入限制在 Run 目录，
  网络仅调研开启——安全边界由沙箱承担，实测模型可正常读输入/写输出。
- turn 完成检测改为 **supervisor stdout 读循环直连 `ai::bridge::record_notification`**
  （原来经 Tauri 事件回环：emit → app.listen → bridge，多一跳且依赖监听注册时机）；
  Tauri 事件保留用于 UI 流式展示。

## 2026-09-14 补记：工作区 Skill 根目录需显式注册

- thread 的 Skill 发现默认只扫 `~/.codex/skills`、`~/.agents/skills` 与插件目录，
  **不包含 cwd 向上走查的 `.agents/skills`**——即使 thread cwd 在工作区内，
  内置 Skill 也不会出现在会话清单（模型会因找不到 Skill 拒绝执行、零产出）。
- 修法：`initialize` 握手后调用 `skills/extraRoots/set`，参数
  `{ "extraRoots": ["<workspace>/.agents/skills"] }`；会话级设置，每次启动
  App Server 注册一次（实测注册后新 thread 的 Skill roots 表出现 r8=工作区目录）。

## 影响

- supervisor 为每个请求维护独立超时（默认 180s，`account/read` 15s）。
- `codex-compatibility.json` 记录 testedVersion/minimumVersion；CI 再生成协议时需同步更新。
