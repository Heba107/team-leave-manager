"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { actions, isAdmin, useAppData } from "@/lib/store";
import { cx } from "./ui";

const LINKS = [
  { href: "/", label: "Dashboard", icon: "▦", adminOnly: false },
  { href: "/leaves", label: "Leave Records", icon: "📝", adminOnly: false, employeeLabel: "My Requests" },
  { href: "/calendar", label: "Calendar", icon: "📅", adminOnly: false },
  { href: "/employees", label: "Employees", icon: "👥", adminOnly: true },
  { href: "/reports", label: "Statistics & Export", icon: "📊", adminOnly: true },
  { href: "/settings", label: "Team Settings", icon: "⚙", adminOnly: true },
  { href: "/account", label: "My Account", icon: "👤", adminOnly: false },
];

/** "Sarah Hasan" → "SH" */
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function Nav() {
  const pathname = usePathname();
  const data = useAppData();
  const [open, setOpen] = useState(false);
  const admin = isAdmin(data);

  const links = (
    <nav className="flex flex-col gap-1">
      {LINKS.filter((l) => admin || !l.adminOnly).map((l) => {
        const isActive = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            onClick={() => setOpen(false)}
            className={cx(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive ? "bg-indigo-50 text-indigo-700" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
            )}
          >
            <span className="w-5 text-center" aria-hidden>
              {l.icon}
            </span>
            {!admin && l.employeeLabel ? l.employeeLabel : l.label}
          </Link>
        );
      })}
    </nav>
  );

  const user = data && (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2">
      <Link
        href="/account"
        onClick={() => setOpen(false)}
        title="My account: profile and password"
        className="flex min-w-0 items-center gap-2 rounded-md hover:opacity-80"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
          {initials(data.me.name)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-zinc-900">{data.me.name}</span>
          <span className="block text-xs text-zinc-500">{admin ? "Admin · Team lead" : "Employee"}</span>
        </span>
      </Link>
      <button onClick={() => actions.signOut()} className="shrink-0 text-xs font-medium text-zinc-500 hover:text-zinc-900">
        Sign out
      </button>
    </div>
  );

  const brand = (
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">TL</div>
      <span className="font-semibold text-zinc-900">Team Leave</span>
    </div>
  );

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-zinc-200 bg-white px-4 py-6 lg:flex">
        <div className="mb-8 px-2">{brand}</div>
        <div className="flex-1">{links}</div>
        {user}
      </aside>
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 lg:hidden">
        {brand}
        <div className="flex items-center gap-1">
          {data && (
            <Link
              href="/account"
              aria-label="My account"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700"
            >
              {initials(data.me.name)}
            </Link>
          )}
          <button
            onClick={() => setOpen((o) => !o)}
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100"
            aria-label="Toggle navigation"
          >
            ☰
          </button>
        </div>
      </header>
      {open && (
        <div className="space-y-3 border-b border-zinc-200 bg-white px-4 py-3 lg:hidden">
          {links}
          {user}
        </div>
      )}
    </>
  );
}
