import { createRootRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { Toaster } from "sonner";

const NAV = [
  { to: "/dashboard", label: "求职看板" },
  { to: "/jobs", label: "岗位库" },
  { to: "/resumes", label: "简历库" },
  { to: "/templates", label: "模板库" },
  { to: "/settings", label: "设置" },
];

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const { pathname } = useLocation();
  return (
    <div className="flex h-full">
      <nav
        aria-label="主导航"
        className="flex w-48 shrink-0 flex-col gap-1 border-r border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="mb-4 px-2 text-lg font-semibold">求职工作台</div>
        {NAV.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`rounded-md px-3 py-2 text-[15px] min-h-[44px] flex items-center ${
                active
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
      <Toaster position="top-center" duration={2500} />
    </div>
  );
}
