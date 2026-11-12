"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileSignature, FolderOpen, LayoutDashboard, LayoutTemplate, LogOut, Plus, Settings, Users } from "lucide-react";
import { signOutAction } from "@/app/(auth)/actions";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, match: ["/dashboard", "/agreements"] },
  { href: "/cases", label: "Files", icon: FolderOpen, match: ["/cases"] },
  { href: "/clients", label: "Clients", icon: Users, match: ["/clients"] },
  { href: "/templates", label: "Templates", icon: LayoutTemplate, match: ["/templates"] },
  { href: "/settings", label: "Settings", icon: Settings, match: ["/settings"] },
];

export function AppShell({ workspaceName, email, children }: { workspaceName: string; email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = (m: string[]) => m.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  // The field editor needs the full width.
  const wide = /\/(prepare)$/.test(pathname) || /^\/templates\/[^/]+$/.test(pathname) && pathname !== "/templates/new";

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r bg-card lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <Link href="/dashboard" className="flex h-14 items-center gap-2 border-b px-5 font-semibold">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground"><FileSignature className="size-4" /></span>
          SignFlow AI
        </Link>
        <div className="px-3 pt-4">
          <Link href="/agreements/new" className="flex h-9 items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90">
            <Plus className="size-4" /> New agreement
          </Link>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                active(n.match) ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <n.icon className="size-4" /> {n.label}
            </Link>
          ))}
        </nav>
        <div className="border-t p-3">
          <div className="px-2.5 pb-2">
            <p className="truncate text-sm font-medium" data-testid="workspace-name">{workspaceName}</p>
            <p className="truncate text-xs text-muted-foreground">{email}</p>
          </div>
          <form action={signOutAction}>
            <button className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground">
              <LogOut className="size-4" /> Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur lg:hidden">
          <div className="flex h-12 items-center justify-between px-4">
            <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
              <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground"><FileSignature className="size-3.5" /></span>
              SignFlow AI
            </Link>
            <form action={signOutAction}><button className="text-xs text-muted-foreground">Sign out</button></form>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium", active(n.match) ? "bg-accent text-accent-foreground" : "text-muted-foreground")}>
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className={cn("mx-auto px-4 py-6 sm:px-6 lg:px-8 lg:py-8", wide ? "max-w-[1400px]" : "max-w-6xl")}>{children}</main>
      </div>
    </div>
  );
}
