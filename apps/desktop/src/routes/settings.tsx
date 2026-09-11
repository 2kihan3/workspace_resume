import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
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
        toast.success("登录流程已发起，请在浏览器完成");
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
    onSuccess: () => toast.success("恢复完成，重启应用生效"),
    onError: (e) => toast.error((e as Error).message),
  });

  const s = status.data;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">设置</h1>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 font-medium">Codex App Server</h2>
        <div className="mb-3 text-sm">
          <div>CLI 路径：{s?.codex_path ?? "未找到（请安装 codex-cli 或在后续版本中指定路径）"}</div>
          <div>版本：{s?.codex_version ?? "—"}</div>
          <div>状态：{s?.app_server_state ?? "stopped"}</div>
          <div>
            登录：{s?.logged_in === true ? `已登录（${s.account_email ?? ""} · ${s.plan_type ?? ""}）` : s?.logged_in === false ? "未登录" : "未知"}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => startServer.mutate()} disabled={startServer.isPending}
            className="min-h-[44px] rounded-md bg-zinc-900 px-4 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
            启动 / 连接
          </button>
          {s?.logged_in ? (
            <button onClick={() => logout.mutate()}
              className="min-h-[44px] rounded-md border border-zinc-300 px-4 dark:border-zinc-700">
              退出登录
            </button>
          ) : (
            <>
              <select value={loginMode} onChange={(e) => setLoginMode(e.target.value as "chatgpt" | "apiKey")}
                className="min-h-[44px] rounded-md border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-800">
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
                  className="min-h-[44px] w-64 rounded-md border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-800"
                />
              )}
              <button onClick={() => login.mutate()} disabled={login.isPending || (loginMode === "apiKey" && !apiKey)}
                className="min-h-[44px] rounded-md border border-zinc-300 px-4 disabled:opacity-50 dark:border-zinc-700">
                登录
              </button>
            </>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 font-medium">Skills（本机工作区 .agents/skills）</h2>
        <div className="flex flex-col gap-2">
          {(skills.data ?? []).map((sk) => (
            <div key={sk.name} className="flex items-center justify-between rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-800/60">
              <div>
                <div className="font-medium">{sk.name}</div>
                <div className="text-zinc-500">{sk.description}</div>
                {sk.error && <div className="text-rose-600">{sk.error}</div>}
              </div>
              {sk.path && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={sk.enabled}
                    onChange={(e) => toggleSkill.mutate({ path: sk.path!, enabled: e.target.checked })} />
                  {sk.enabled ? "已启用" : "已停用"}
                </label>
              )}
            </div>
          ))}
          {skills.data?.length === 0 && (
            <div className="text-sm text-zinc-500">
              暂无 Skill。启动 App Server 后会加载工作区中的内置 Skill。
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 font-medium">备份与恢复</h2>
        <div className="flex gap-2">
          <button onClick={() => backup.mutate()}
            className="min-h-[44px] rounded-md bg-zinc-900 px-4 text-white dark:bg-zinc-100 dark:text-zinc-900">
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
            className="min-h-[44px] rounded-md border border-zinc-300 px-4 dark:border-zinc-700">
            从备份恢复
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">备份包含数据库与工作区，不含 Codex 凭据、日志与临时 AI 运行目录。</p>
      </section>
    </div>
  );
}
