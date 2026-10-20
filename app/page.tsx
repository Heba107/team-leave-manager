"use client";

import Link from "next/link";
import { addDays, endOfMonth, formatDate, formatMonth, formatShort, startOfMonth, todayISO } from "@/lib/dates";
import { approved, isOnLeave, leaveDays, leaveDaysWithin, overlapGroups, overlapsRange } from "@/lib/leave";
import { actions, useAppData } from "@/lib/store";
import { Button, buttonClass, Card, EmptyState, Loading, PageHeader, StatCard, StatusBadge, TypeBadge } from "@/components/ui";

const UPCOMING_WINDOW = 30;

export default function Dashboard() {
  const data = useAppData();
  if (!data) return <Loading />;

  const { employees, leaves, settings } = data;
  const today = todayISO();
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name ?? "Unknown";

  const activeMembers = employees.filter((e) => e.active);
  const approvedLeaves = approved(leaves);
  const onLeaveNow = approvedLeaves.filter((l) => isOnLeave(l, today));
  const thisMonth = approvedLeaves.filter((l) => overlapsRange(l, monthStart, monthEnd));
  const thisMonthDays = thisMonth.reduce((sum, l) => sum + leaveDaysWithin(l, monthStart, monthEnd, settings), 0);
  const upcoming = leaves
    .filter((l) => l.status !== "Rejected" && l.startDate > today && l.startDate <= addDays(today, UPCOMING_WINDOW))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const overlaps = overlapGroups(leaves, today);
  const pending = leaves.filter((l) => l.status === "Pending").sort((a, b) => a.startDate.localeCompare(b.startDate));

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Overview for ${formatDate(today)}`}
        actions={
          <Link href="/leaves?new=1" className={buttonClass()}>
            + New leave
          </Link>
        }
      />

      {employees.length === 0 && (
        <div className="mb-6 rounded-xl border border-indigo-100 bg-indigo-50 px-5 py-4 text-sm text-indigo-900">
          The database is empty. <Link href="/employees" className="font-medium underline">Add your team members</Link>, or load
          the sample team (or import your earlier browser data) from <Link href="/settings" className="font-medium underline">Settings</Link>.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Team members"
          value={activeMembers.length}
          hint={`${employees.length - activeMembers.length} inactive`}
        />
        <StatCard
          label="On leave today"
          value={onLeaveNow.length}
          hint={activeMembers.length ? `${Math.round((onLeaveNow.length / activeMembers.length) * 100)}% of the team` : undefined}
        />
        <StatCard
          label={`${formatMonth(today)}`}
          value={
            <span>
              {thisMonthDays}
              <span className="ml-1 text-base font-normal text-zinc-500">days</span>
            </span>
          }
          hint={`${thisMonth.length} leave occasion${thisMonth.length === 1 ? "" : "s"} · approved only`}
        />
        <StatCard label="Upcoming leaves" value={upcoming.length} hint={`Next ${UPCOMING_WINDOW} days, incl. pending`} />
        <StatCard
          label="Overlap warnings"
          value={overlaps.length}
          hint={overlaps.length ? "Periods with 2+ people off" : "No overlapping leaves ahead"}
          tone={overlaps.length ? "warning" : "default"}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Who's off today">
          {onLeaveNow.length === 0 ? (
            <EmptyState>Everyone is in today 🎉</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {onLeaveNow.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="font-medium text-zinc-900">{nameOf(l.employeeId)}</p>
                    <p className="text-xs text-zinc-500">
                      Back on {formatDate(addDays(l.endDate, 1))}
                    </p>
                  </div>
                  <TypeBadge type={l.type} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Overlapping leave warnings" tone={overlaps.length ? "warning" : undefined}>
          {overlaps.length === 0 ? (
            <EmptyState>No overlapping leaves from today onward.</EmptyState>
          ) : (
            <ul className="divide-y divide-amber-100">
              {overlaps.map((g) => (
                <li key={g.startDate + g.endDate} className="px-5 py-3">
                  <p className="text-sm font-medium text-amber-900">
                    ⚠ {formatShort(g.startDate)}
                    {g.endDate !== g.startDate && ` – ${formatShort(g.endDate)}`}: {new Set(g.leaves.map((l) => l.employeeId)).size} people off
                  </p>
                  <p className="mt-0.5 text-xs text-amber-800">
                    {g.leaves.map((l) => `${nameOf(l.employeeId)}${l.status === "Pending" ? " (pending)" : ""}`).join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`Upcoming (next ${UPCOMING_WINDOW} days)`}>
          {upcoming.length === 0 ? (
            <EmptyState>No upcoming leaves.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {upcoming.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-zinc-900">{nameOf(l.employeeId)}</p>
                    <p className="text-xs text-zinc-500">
                      {formatShort(l.startDate)} → {formatShort(l.endDate)} · {leaveDays(l, settings)} day
                      {leaveDays(l, settings) === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <TypeBadge type={l.type} />
                    <StatusBadge status={l.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`Pending approval (${pending.length})`}>
          {pending.length === 0 ? (
            <EmptyState>Nothing waiting for approval.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {pending.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-zinc-900">
                      {nameOf(l.employeeId)} <TypeBadge type={l.type} />
                    </p>
                    <p className="text-xs text-zinc-500">
                      {formatShort(l.startDate)} → {formatShort(l.endDate)} · {leaveDays(l, settings)} days
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => actions.updateLeave(l.id, { status: "Approved" })}>
                      Approve
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => actions.updateLeave(l.id, { status: "Rejected" })}>
                      Reject
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, tone, children }: { title: string; tone?: "warning"; children: React.ReactNode }) {
  return (
    <Card className={tone === "warning" ? "border-amber-300" : undefined}>
      <div className={tone === "warning" ? "border-b border-amber-200 bg-amber-50 px-5 py-3 rounded-t-xl" : "border-b border-zinc-100 px-5 py-3"}>
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      </div>
      {children}
    </Card>
  );
}
