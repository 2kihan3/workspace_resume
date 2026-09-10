/**
 * Codex App Server 协议访问层。
 *
 * wire type 一律来自 `codex app-server generate-ts` 的生成物
 * （packages/app-server-protocol/generated，由 codex-cli 0.144.1 生成），
 * 禁止手写或猜测消息结构（spec §10.1 / §17）。
 *
 * 本包只做两件事：
 * 1. re-export 生成类型；
 * 2. 提供客户端用的方法名常量（wire method name 不在生成类型里，单独维护）。
 */
export type * from "../generated/index";
export * as protocolV2 from "../generated/v2";

/** 客户端 -> server 请求方法名（由 codex-cli 0.144.1 错误响应枚举确认）。 */
export const ClientMethods = {
  initialize: "initialize",
  threadStart: "thread/start",
  threadResume: "thread/resume",
  threadList: "thread/list",
  turnStart: "turn/start",
  turnInterrupt: "turn/interrupt",
  skillsList: "skills/list",
  skillsConfigWrite: "skills/config/write",
  accountRead: "account/read",
  accountLoginStart: "account/login/start",
  accountLoginCancel: "account/login/cancel",
  accountLogout: "account/logout",
  getAuthStatus: "getAuthStatus",
  modelList: "model/list",
} as const;

/** server -> client 通知（节选，随生成物版本更新）。 */
export const ServerNotifications = {
  accountLoginCompleted: "account/login/completed",
  accountUpdated: "account/updated",
  skillsChanged: "skills/changed",
  turnCompleted: "turn/completed",
  turnAborted: "turn/aborted",
  turnStarted: "turn/started",
  error: "error",
} as const;
