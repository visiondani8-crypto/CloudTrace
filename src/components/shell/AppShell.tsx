"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { signOut } from "next-auth/react";
import {
  Archive,
  Building2,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Microscope,
  Network,
  Plug,
  Search,

  Settings,
  Siren,
  UserRound,
  X,
} from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { Menu, MenuItem } from "@/components/ui/interactive";
import { Tag, cx } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import type { Tone } from "@/lib/ui/labels";
import { GlobalSearch } from "./GlobalSearch";

export interface ShellProps {
  user: { name: string; email: string; role: string };
  organization: { id: string; name: string };
  memberships: { organizationId: string; organizationName: string; role: string }[];
  source: { label: string; tone: Tone; environment: "DEMO" | "CONNECTED TENANT" };
  footer: string;
  children: ReactNode;
}

const NAV = [
  {
    group: "Operations",
    items: [
      { href: "/overview", label: "Command overview", icon: LayoutDashboard, match: ["/overview"] },
      { href: "/incidents", label: "Incidents", icon: Siren, match: ["/incidents"] },
    ],
  },
  {
    group: "Investigation",
    items: [
      { href: "/investigations", label: "Investigation lab", icon: Microscope, match: ["/investigations"] },
      { href: "/assets", label: "Asset graph", icon: Network, match: ["/assets"] },
      { href: "/evidence", label: "Evidence vault", icon: Archive, match: ["/evidence"] },
      { href: "/reports", label: "Reports", icon: FileText, match: ["/reports"] },
    ],
  },
  {
    group: "Administration",
    items: [
      { href: "/integrations", label: "Integrations", icon: Plug, match: ["/integrations"] },
      { href: "/activity", label: "Activity & audit", icon: History, match: ["/activity"] },
      { href: "/settings", label: "Settings", icon: Settings, match: ["/settings"] },
    ],
  },
];

function UtcClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  if (!now) return null;
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  return (
    <span className="ct-mono hidden text-[12px] text-fg-2 xl:inline" aria-label={`Current time ${hh}:${mm} UTC`}>
      {hh}:{mm} UTC
    </span>
  );
}

function OrgSwitcher({ organization, memberships }: Pick<ShellProps, "organization" | "memberships">) {
  const router = useRouter();
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  if (memberships.length <= 1) {
    return (
      <span className="hidden items-center gap-1.5 text-[12px] text-fg-2 lg:inline-flex" title="Current workspace">
        <Building2 size={14} aria-hidden="true" />
        <span className="max-w-[180px] truncate">{organization.name}</span>
      </span>
    );
  }
  return (
    <label className="hidden items-center gap-1.5 text-[12px] text-fg-2 lg:inline-flex">
      <Building2 size={14} aria-hidden="true" />
      <span className="ct-sr-only">Workspace</span>
      <select
        className="ct-field min-h-[32px] w-auto py-1 text-[12px]"
        value={organization.id}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          const res = await api("/api/session/organization", { body: { organizationId: e.target.value } });
          setBusy(false);
          if (!res.ok) return notify(res.error.message, "danger");
          router.push("/overview");
          router.refresh();
        }}
      >
        {memberships.map((m) => (
          <option key={m.organizationId} value={m.organizationId}>
            {m.organizationName}
          </option>
        ))}
      </select>
    </label>
  );
}

function ShellInner({ user, organization, memberships, source, footer, children }: ShellProps) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);

  useEffect(() => setNavOpen(false), [pathname]);
  useEffect(() => {
    if (!navOpen) return;
    const first = sidebar.current?.querySelector<HTMLElement>("a");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNavOpen(false);
        menuButton.current?.focus();
      }
      if (e.key === "Tab" && sidebar.current) {
        const links = Array.from(sidebar.current.querySelectorAll<HTMLElement>("a,button"));
        const firstEl = links[0];
        const lastEl = links[links.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const isActive = (match: string[]) => match.some((m) => pathname === m || pathname.startsWith(`${m}/`));

  return (
    <div className="ct-shell">
      <a href="#main" className="ct-sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to main content
      </a>
      <header className="ct-topbar" role="banner">
        <button
          ref={menuButton}
          type="button"
          className="ct-menu-button ct-btn h-11 w-11 p-0"
          data-variant="ghost"
          aria-label={navOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={navOpen}
          aria-controls="ct-sidebar"
          onClick={() => setNavOpen((v) => !v)}
        >
          {navOpen ? <X size={18} /> : <MenuIcon size={18} />}
        </button>
        <Link prefetch={false} href="/overview" className="flex items-center gap-2.5 no-underline" aria-label="CloudTrace — Command overview">
          <span className="ct-brand-mark" aria-hidden="true">
            CT
          </span>
          <span className="ct-brand-wordmark hidden sm:inline">CloudTrace</span>
        </Link>
        <span className="ct-product-caption hidden md:inline">Security operations</span>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <GlobalSearch />
          <button type="button" className="ct-btn h-11 w-11 p-0 md:hidden" data-variant="ghost" aria-label="Search incidents, assets and evidence" onClick={() => setSearchOpen(true)}>
            <Search size={17} />
          </button>
          <UtcClock />
          <Tag tone={source.tone} title="Data source status">
            <span className="hidden sm:inline">{source.environment} · </span>
            {source.label}
          </Tag>
          <OrgSwitcher organization={organization} memberships={memberships} />
          <Menu
            label="Account menu"
            trigger={
              <>
                <UserRound size={15} aria-hidden="true" />
                <span className="hidden max-w-[140px] truncate lg:inline">{user.name}</span>
                <span className="ct-sr-only">Account menu for {user.name}</span>
              </>
            }
          >
            {() => (
              <>
                <div className="px-2.5 pb-2 pt-1.5 text-[12px] leading-[18px]">
                  <div className="font-semibold text-fg">{user.name}</div>
                  <div className="text-fg-2">{user.email}</div>
                  <div className="text-fg-2">
                    {user.role.charAt(0) + user.role.slice(1).toLowerCase()} · {organization.name}
                  </div>
                </div>
                <MenuItem href="/settings?tab=profile" icon={<UserRound />}>
                  My profile
                </MenuItem>
                <MenuItem icon={<LogOut />} onSelect={() => signOut({ callbackUrl: "/login" })}>
                  Sign out
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      </header>

      <div className="ct-nav-backdrop" data-open={navOpen} onClick={() => setNavOpen(false)} aria-hidden="true" />
      <nav id="ct-sidebar" ref={sidebar} className="ct-sidebar" data-open={navOpen} aria-label="Primary">
        {NAV.map((group) => (
          <div key={group.group}>
            <div className="ct-nav-group-label">{group.group}</div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.match);
              return (
                <Link prefetch={false}
                  key={item.href}
                  href={item.href}
                  className="ct-nav-item"
                  aria-current={active ? "page" : undefined}
                  title={item.label}
                >
                  <Icon aria-hidden="true" />
                  <span data-label>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
        <div className="ct-sidebar-footer">
          <div className="flex items-center gap-1.5 font-semibold uppercase tracking-[0.6px] text-fg-2">
            <span className={cx("inline-block h-1.5 w-1.5 rounded-full", source.environment === "DEMO" ? "bg-amber" : "bg-green")} aria-hidden="true" />
            {source.environment === "DEMO" ? "Demo workspace" : "Connected tenant"}
          </div>
          <div className="mt-1">{footer}</div>
        </div>
      </nav>

      <Dialog open={searchOpen} onClose={() => setSearchOpen(false)} title="Search workspace" description="Incidents, case IDs, assets and evidence in this workspace.">
        <GlobalSearch variant="overlay" onNavigate={() => setSearchOpen(false)} />
      </Dialog>
      <main id="main" className="ct-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

export function AppShell(props: ShellProps) {
  return (
    <ToastProvider>
      <ShellInner {...props} />
    </ToastProvider>
  );
}

