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
        className="flex w-52 shrink-0 flex-col gap-1 border-r border-border bg-card p-3"
      >
        <div className="mb-4 flex items-center gap-2.5 px-2 py-2">
          <span
            aria-hidden
            className="grid size-9 place-items-center rounded-lg bg-primary font-semibold text-primary-foreground"
          >
            职
          </span>
          <span className="text-base font-semibold">求职工作台</span>
        </div>
        {NAV.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 items-center rounded-lg px-3 text-[15px] transition-colors duration-150 ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
