"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cx } from "./ui";

const LINKS = [
  { href: "/", label: "Dashboard", icon: "▦" },
  { href: "/employees", label: "Employees", icon: "👥" },
  { href: "/leaves", label: "Leave Records", icon: "📝" },
  { href: "/calendar", label: "Calendar", icon: "📅" },
  { href: "/reports", label: "Statistics & Export", icon: "📊" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = (
    <nav className="flex flex-col gap-1">
      {LINKS.map((l) => {
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
            {l.label}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">TL</div>
      <span className="font-semibold text-zinc-900">Team Leave</span>
    </div>
  );

  return (
    <>
      <aside className="hidden w-60 shrink-0 border-r border-zinc-200 bg-white px-4 py-6 lg:block">
        <div className="mb-8 px-2">{brand}</div>
        {links}
      </aside>
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 lg:hidden">
        {brand}
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100"
          aria-label="Toggle navigation"
        >
          ☰
        </button>
      </header>
      {open && <div className="border-b border-zinc-200 bg-white px-4 py-3 lg:hidden">{links}</div>}
    </>
  );
}
