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

## 影响

- supervisor 为每个请求维护独立超时（默认 180s，`account/read` 15s）。
- `codex-compatibility.json` 记录 testedVersion/minimumVersion；CI 再生成协议时需同步更新。
