import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { SkillInfo } from "../lib/ipc";
import { api } from "../lib/constants";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["ai-status"], queryFn: api.readAIStatus, refetchInterval: 15000 });
  const skills = useQuery({ queryKey: ["skills"], queryFn: () => api.listSkills(false) });
  const [loginMode, setLoginMode] = useState<"chatgpt" | "apiKey">("chatgpt");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    const un = listen("app-server-state-changed", () => {
      qc.invalidateQueries({ queryKey: ["ai-status"] });
    });
    return () => { un.then((f) => f()); };
  }, [qc]);

  const startServer = useMutation({
    mutationFn: api.startAppServer,
    onSuccess: () => {
      toast.success("App Server 已就绪");
      qc.invalidateQueries({ queryKey: ["ai-status"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const login = useMutation({
    mutationFn: async () => {
      const r = await api.startLogin(loginMode, apiKey);
      setApiKey(""); // 立即清空，不落盘（spec §10.3）
      if (r.auth_url) window.open(r.auth_url, "_blank");
      return r;
    },
    onSuccess: (r) => {
      if (r.kind === "chatgptDeviceCode" && r.user_code) {
        toast.info(`请在浏览器输入授权码：${r.user_code}`);
      } else {
        toast.success("已在浏览器打开登录页，完成后回来即可");
      }
      qc.invalidateQueries({ queryKey: ["ai-status"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-status"] }),
  });

  const toggleSkill = useMutation({
    mutationFn: (args: { path: string; enabled: boolean }) => api.setSkillEnabled(args.path, args.enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });

  const backup = useMutation({
    mutationFn: api.createBackup,
    onSuccess: (p) => toast.success(`备份已创建：${p}`),
    onError: (e) => toast.error((e as Error).message),
  });
  const restore = useMutation({
    mutationFn: (path: string) => api.restoreBackup(path),
    onSuccess: () => toast.success("恢复完成，重启应用后生效"),
    onError: (e) => toast.error((e as Error).message),
  });

  const s = status.data;
  const appInfo = useQuery({ queryKey: ["app-info"], queryFn: api.appInfo, staleTime: Infinity });
  // Codex 把工作区发现的所有 Skill（含全局 ~/.agents/skills）都归在同一 cwd
  // 条目下，cwd 无法区分——按 path 前缀分组：内置 Skill 安装在
  // <app_data>/workspace/.agents/skills，其余为本机个人 Skill。
  const workspaceSkillsDir = appInfo.data?.app_data_dir
    ? `${appInfo.data.app_data_dir}/workspace/.agents/skills`
    : "";
  const isBuiltin = (sk: SkillInfo) =>
    workspaceSkillsDir !== "" &&
    (!!sk.path?.startsWith(workspaceSkillsDir) || (!sk.path && !!sk.error));
  const machineSkills = (skills.data ?? []).filter((sk) => !isBuiltin(sk));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">设置</h1>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 font-medium">Codex App Server</h2>
        <div className="mb-3 text-sm">
          <div>CLI 路径：{s?.codex_path ?? "未找到，请先安装 codex-cli"}</div>
          <div>版本：{s?.codex_version ?? "—"}</div>
          <div>状态：{s?.app_server_state ?? "stopped"}</div>
          <div>
            登录：{s?.logged_in === true ? `已登录（${s.account_email ?? ""} · ${s.plan_type ?? ""}）` : s?.logged_in === false ? "未登录" : "未知"}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => startServer.mutate()} disabled={startServer.isPending}
            className="h-11  rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
            启动 / 连接
          </button>
          {s?.logged_in ? (
            <button onClick={() => logout.mutate()}
              className="h-11  rounded-md border border-input bg-card px-4 hover:bg-muted">
              退出登录
            </button>
          ) : (
            <>
              <select value={loginMode} onChange={(e) => setLoginMode(e.target.value as "chatgpt" | "apiKey")}
                className="h-11 rounded-md border border-input bg-card px-3">
                <option value="chatgpt">ChatGPT 登录</option>
                <option value="apiKey">API Key</option>
              </select>
              {loginMode === "apiKey" && (
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-…（仅内存使用，不保存）"
                  className="h-11 w-64 rounded-md border border-input bg-card px-3"
                />
              )}
              <button onClick={() => login.mutate()} disabled={login.isPending || (loginMode === "apiKey" && !apiKey)}
                className="h-11  rounded-md border border-zinc-300 px-4 disabled:opacity-50 dark:border-zinc-700">
                登录
              </button>
            </>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 font-medium">Skills</h2>
        {/* 应用工作区内置 Skill：置顶展开（AI 任务实际使用这三个） */}
        <p className="mb-2 text-xs text-muted-foreground">应用工作区（内置，AI 任务使用）</p>
        <div className="flex flex-col gap-2">
          {(skills.data ?? []).filter(isBuiltin).map((sk) => (
              <div key={sk.name} className="flex items-center justify-between rounded-md bg-card p-3 text-sm outline outline-1 outline-border">
                <div className="min-w-0">
                  <div className="font-medium">{sk.name}</div>
                  <div className="truncate text-muted-foreground" title={sk.description}>{sk.description}</div>
                  {sk.error && <div className="text-destructive">{sk.error}</div>}
                </div>
                {sk.path && (
                  <label className="flex shrink-0 cursor-pointer items-center gap-2">
                    <input type="checkbox" checked={sk.enabled}
                      onChange={(e) => toggleSkill.mutate({ path: sk.path!, enabled: e.target.checked })} />
                    {sk.enabled ? "已启用" : "已停用"}
                  </label>
                )}
              </div>
            ))}
          {skills.data?.length === 0 && (
            <div className="text-sm text-muted-foreground">
              还没有加载到 Skill。先启动 App Server，工作区里的内置 Skill 会自动出现。
            </div>
          )}
        </div>
        {/* 本机个人 Skill：默认折叠，仅计数，不参与本应用任务 */}
        {machineSkills.length > 0 && (
          <details className="mt-3 rounded-md bg-muted/60 p-3">
            <summary className="cursor-pointer text-sm text-muted-foreground">
              本机个人 Skill（{machineSkills.length} 个，来自 ~/.agents/skills 等目录；
              本应用任务不会使用，展开可查看与启停）
            </summary>
            <div className="mt-2 flex max-h-56 flex-col gap-1.5 overflow-auto">
              {machineSkills.map((sk) => (
                <div key={`${sk.cwd}/${sk.name}`} className="flex items-center justify-between gap-2 rounded bg-card p-2 text-xs">
                  <span className="min-w-0 flex-1 truncate" title={`${sk.name} · ${sk.cwd}`}>{sk.name}</span>
                  {sk.path && (
                    <label className="flex shrink-0 cursor-pointer items-center gap-1 text-muted-foreground">
                      <input
                        type="checkbox" checked={sk.enabled}
                        onChange={(e) => toggleSkill.mutate({ path: sk.path!, enabled: e.target.checked })}
                      />
                      {sk.enabled ? "启用" : "停用"}
                    </label>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 font-medium">备份与恢复</h2>
        <div className="flex gap-2">
          <button onClick={() => backup.mutate()}
            className="h-11  rounded-md bg-primary px-4 text-primary-foreground hover:opacity-90">
            创建备份（.jsw-backup）
          </button>
          <button
            onClick={async () => {
              const path = await open({
                multiple: false,
                directory: false,
                title: "选择备份文件",
                filters: [{ name: "备份文件", extensions: ["jsw-backup", "zip"] }],
              });
              if (!path || typeof path !== "string") return;
              restore.mutate(path);
            }}
            className="h-11  rounded-md border border-input bg-card px-4 hover:bg-muted">
            从备份恢复
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">备份里有数据库和工作区；Codex 凭据、日志和临时的 AI 运行目录不会进去。</p>
      </section>
    </div>
  );
}
