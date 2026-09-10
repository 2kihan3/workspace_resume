# ADR-0003：AI Run 两阶段提交与 turn 完成检测

状态：已接受（2026-09-11）

## 背景

方案 §10.6 要求 AI 输出先写 `.pending`、数据库事务提交后再原子重命名，
并在启动时执行恢复扫描。turn 完成通知经 Tauri 事件桥接。

## 决策

1. 队列全局并发 1（`AIService::spawn_worker`），按 `queued_at` FIFO。
2. Run 目录：`workspace/ai-runs/<run-id>/{inputs,outputs,run-manifest.json}`，
   输入快照含 SHA-256；thread 的 cwd 指向该目录，沙箱可写根仅为该目录。
3. 提交流程：校验必需输出 → 复制为正式路径 `.pending` → 数据库事务
   （artifact 登记 / 状态推进 / run 置 succeeded）→ rename 去掉 `.pending`；
   事务失败则隔离 `.pending` 并置 run failed。
4. turn 完成检测：supervisor 将 server 通知转成 `app-server-notification` 事件，
   命令层调用 `ai::bridge::record_notification` 登记（`turn/completed` / `turn/aborted`），
   执行器每 2 秒检查，10 分钟超时。
5. 启动恢复扫描（lib.rs setup + `run_recovery_scan` 命令）：
   artifacts 已登记的 `.pending` 完成重命名，否则移入 `quarantine/`。

## 影响

- 崩溃后可能存在的中间状态仅限 `.pending` 文件，可由恢复扫描收敛。
- 通知方法名随协议版本演进，`bridge` 中的枚举需与 `codex-compatibility.json` 同步更新。
