"use client";

import { useState } from "react";
import { actions } from "@/lib/store";
import type { Employee, Squad } from "@/lib/types";
import { Button, cx, EmptyState, inputClass } from "./ui";

// Full class names so Tailwind keeps them; a squad always gets the same colour.
const BADGE_COLORS = [
  "bg-violet-50 text-violet-700 ring-violet-200",
  "bg-teal-50 text-teal-700 ring-teal-200",
  "bg-orange-50 text-orange-700 ring-orange-200",
  "bg-sky-50 text-sky-700 ring-sky-200",
  "bg-pink-50 text-pink-700 ring-pink-200",
  "bg-lime-50 text-lime-800 ring-lime-200",
  "bg-indigo-50 text-indigo-700 ring-indigo-200",
  "bg-amber-50 text-amber-800 ring-amber-200",
];

function colorFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BADGE_COLORS[h % BADGE_COLORS.length];
}

export function SquadBadge({ squad }: { squad: Squad | undefined }) {
  if (!squad) return null;
  return (
    <span
      title={`Squad: ${squad.name}`}
      className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", colorFor(squad.id))}
    >
      {squad.name}
    </span>
  );
}

/** "" = all squads, "none" = people without a squad, otherwise a squad id. */
export type SquadFilterValue = string;

export function matchesSquad(squadId: string | null | undefined, filter: SquadFilterValue) {
  return !filter || (filter === "none" ? !squadId : squadId === filter);
}

export function SquadFilter({
  squads,
  value,
  onChange,
  className,
}: {
  squads: Squad[];
  value: SquadFilterValue;
  onChange: (v: SquadFilterValue) => void;
  className?: string;
}) {
  return (
    <select className={cx(inputClass, className)} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Squad">
      <option value="">All squads</option>
      {squads.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
      <option value="none">No squad</option>
    </select>
  );
}

/** Admin panel: create, rename, set the lead of, and delete squads. */
export function SquadManager({ squads, employees }: { squads: Squad[]; employees: Employee[] }) {
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const active = employees.filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name));
  const taken = (name: string, exceptId?: string) =>
    squads.some((s) => s.id !== exceptId && s.name.trim().toLowerCase() === name.trim().toLowerCase());

  function add(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return setError("Enter a squad name");
    if (taken(name)) return setError("A squad with this name already exists");
    setError("");
    setNewName("");
    actions.addSquad(name);
  }

  return (
    <div className="space-y-4">
      {squads.length === 0 ? (
        <EmptyState>No squads yet. Create the first one below.</EmptyState>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-lg ring-1 ring-zinc-200">
          {squads.map((s) => {
            const members = employees.filter((e) => e.squadId === s.id && e.active).length;
            return (
              <li key={s.id} className="space-y-2 p-3">
                <div className="flex items-center gap-2">
                  <input
                    className={cx(inputClass, "flex-1")}
                    defaultValue={s.name}
                    aria-label="Squad name"
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (!name || taken(name, s.id)) {
                        e.target.value = s.name;
                        if (name) setError(`"${name}" is already used by another squad`);
                        return;
                      }
                      if (name !== s.name) actions.updateSquad(s.id, { name });
                    }}
                  />
                  <span className="shrink-0 text-xs text-zinc-500">
                    {members} member{members === 1 ? "" : "s"}
                  </span>
                  {confirmDelete === s.id ? (
                    <Button size="sm" variant="danger" onClick={() => actions.deleteSquad(s.id)}>
                      Confirm
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setConfirmDelete(s.id)}>
                      Delete
                    </Button>
                  )}
                </div>
                <label className="flex items-center gap-2 text-xs text-zinc-600">
                  <span className="shrink-0">Squad lead</span>
                  <select
                    className={cx(inputClass, "py-1 text-xs")}
                    value={s.leadId ?? ""}
                    onChange={(e) => actions.updateSquad(s.id, { leadId: e.target.value || null })}
                  >
                    <option value="">None</option>
                    {active.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                {confirmDelete === s.id && (
                  <p className="text-xs text-rose-700">Members will be left without a squad. Their leave records are kept.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={add} className="flex gap-2">
        <input className={inputClass} placeholder="New squad name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button type="submit">Add</Button>
      </form>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <p className="text-xs text-zinc-500">
        Squad leads get a handover email listing the member&apos;s open Jira tasks when leave is approved and 3 days before it starts.
        Request emails and approvals still follow each person&apos;s direct manager and the General Manager.
      </p>
    </div>
  );
}
