"use client";

import Link from "next/link";
import { AttachmentLink } from "@/components/LeaveForm";
import { SquadBadge } from "@/components/Squads";
import { Button, buttonClass, Card, cx, EmptyState, Loading, PageHeader, StatCard, StatusBadge, TypeBadge } from "@/components/ui";
import { addDays, endOfMonth, formatDate, formatMonth, formatShort, startOfMonth, todayISO } from "@/lib/dates";
import {
  annualBalance,
  approved,
  describeDuration,
  formatDays,
  formatHours,
  holidayOn,
  isOnLeave,
  leaveDaysWithin,
  overlapGroups,
  overlapsRange,
} from "@/lib/leave";
import { actions, useAppData } from "@/lib/store";
import type { AppData } from "@/lib/types";

const UPCOMING_WINDOW = 30;

export default function Dashboard() {
  const data = useAppData();
  if (!data) return <Loading />;
  return data.me.role === "admin" ? <TeamDashboard data={data} /> : <MyDashboard data={data} />;
}

function TeamDashboard({ data }: { data: AppData }) {
  const { employees, leaves } = data;
  const today = todayISO();
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const year = Number(today.slice(0, 4));
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name ?? "Unknown";

  const activeMembers = employees.filter((e) => e.active);
  const approvedLeaves = approved(leaves);
  const onLeaveNow = approvedLeaves.filter((l) => isOnLeave(l, today));
  const thisMonth = approvedLeaves.filter((l) => overlapsRange(l, monthStart, monthEnd));
  const thisMonthDayLeaves = thisMonth.filter((l) => l.durationType !== "hourly");
  const thisMonthDays = thisMonthDayLeaves.reduce((sum, l) => sum + leaveDaysWithin(l, monthStart, monthEnd, data), 0);
  const thisMonthHours = thisMonth.reduce((sum, l) => sum + (l.durationType === "hourly" ? (l.hours ?? 0) : 0), 0);
  const upcoming = leaves
    .filter((l) => l.status !== "Rejected" && l.startDate > today && l.startDate <= addDays(today, UPCOMING_WINDOW))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const overlaps = overlapGroups(leaves, today);
  const pending = leaves.filter((l) => l.status === "Pending").sort((a, b) => a.startDate.localeCompare(b.startDate));
  const lowBalance = activeMembers
    .map((e) => ({ e, b: annualBalance(e, leaves, year, data) }))
    .filter(({ b }) => b.available <= 3)
    .sort((a, b) => a.b.available - b.b.available);
  const holidayToday = holidayOn(today, data.holidays);
  const nextHoliday = data.holidays.find((h) => h.endDate >= today);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Overview for ${formatDate(today)}${holidayToday ? ` · 🎉 ${holidayToday.name}` : ""}`}
        actions={
          <Link href="/leaves?new=1" className={buttonClass()}>
            + New leave
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Team members" value={activeMembers.length} hint={`${employees.length - activeMembers.length} inactive`} />
        <StatCard
          label="On leave today"
          value={onLeaveNow.length}
          hint={activeMembers.length ? `${Math.round((onLeaveNow.length / activeMembers.length) * 100)}% of the team` : undefined}
        />
        <StatCard
          label={formatMonth(today)}
          value={
            <span>
              {formatDays(thisMonthDays)}
              <span className="ml-1 text-base font-normal text-zinc-500">days</span>
            </span>
          }
          hint={`${thisMonthDayLeaves.length} occasion${thisMonthDayLeaves.length === 1 ? "" : "s"}${thisMonthHours ? ` · ${formatHours(thisMonthHours)} permissions` : ""} · approved only`}
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
        <Panel title={`Pending approval (${pending.length})`}>
          {pending.length === 0 ? (
            <EmptyState>Nothing waiting for approval.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {pending.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 font-medium text-zinc-900">
                      {nameOf(l.employeeId)} <SquadBadge squad={data.squads.find((s) => s.id === employees.find((e) => e.id === l.employeeId)?.squadId)} />
                      <TypeBadge type={l.type} />
                    </p>
                    <p className="text-xs text-zinc-500">
                      {formatShort(l.startDate)}
                      {l.endDate !== l.startDate && ` → ${formatShort(l.endDate)}`} · {describeDuration(l, data)}
                      {l.backupEmployeeId && ` · backup: ${nameOf(l.backupEmployeeId)}`}
                    </p>
                    {l.attachmentPath && (
                      <span className="text-xs">
                        <AttachmentLink path={l.attachmentPath} compact />
                      </span>
                    )}
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

        <Panel title="Who's off today">
          {onLeaveNow.length === 0 ? (
            <EmptyState>{holidayToday ? `Public holiday: ${holidayToday.name}` : "Everyone is in today 🎉"}</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {onLeaveNow.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="font-medium text-zinc-900">{nameOf(l.employeeId)}</p>
                    <p className="text-xs text-zinc-500">
                      {l.durationType === "full" ? `Back on ${formatDate(addDays(l.endDate, 1))}` : describeDuration(l, data)}
                      {l.backupEmployeeId && ` · backup: ${nameOf(l.backupEmployeeId)}`}
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
                      {formatShort(l.startDate)}
                      {l.endDate !== l.startDate && ` → ${formatShort(l.endDate)}`} · {describeDuration(l, data)}
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

        <Panel title={`Low annual balance (${year})`}>
          {lowBalance.length === 0 ? (
            <EmptyState>Everyone has more than 3 days left.</EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {lowBalance.map(({ e, b }) => (
                <li key={e.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span className="font-medium text-zinc-900">{e.name}</span>
                  <span className={cx("tabular-nums", b.remaining < 0 ? "font-semibold text-rose-700" : "text-zinc-600")}>
                    {formatDays(b.remaining)} days left
                    {b.carriedAvailable > 0 && <span className="text-zinc-400"> (incl. {formatDays(b.carriedAvailable)} carried)</span>}
                    {b.pending > 0 && <span className="text-zinc-400"> · {formatDays(b.pending)} pending</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Next public holiday">
          {nextHoliday ? (
            <div className="px-5 py-4 text-sm">
              <p className="font-medium text-zinc-900">{nextHoliday.name}</p>
              <p className="text-zinc-500">
                {formatDate(nextHoliday.startDate)}
                {nextHoliday.endDate !== nextHoliday.startDate && ` → ${formatDate(nextHoliday.endDate)}`}
              </p>
            </div>
          ) : (
            <EmptyState>
              No upcoming holidays configured. <Link href="/settings" className="text-indigo-600 underline">Add them in Settings</Link>.
            </EmptyState>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** Employee view: own balance and requests only (the database only returns their own rows). */
function MyDashboard({ data }: { data: AppData }) {
  const today = todayISO();
  const year = Number(today.slice(0, 4));
  const me = data.me;
  const balance = annualBalance(me, data.leaves, year, data);
  const mine = data.leaves.filter((l) => l.employeeId === me.id).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const upcoming = mine.filter((l) => l.endDate >= today && l.status !== "Rejected").reverse();
  const recent = mine.filter((l) => l.endDate < today || l.status === "Rejected").slice(0, 8);
  const nameOf = (id: string) => data.directory.find((e) => e.id === id)?.name ?? "—";
  const nextHoliday = data.holidays.find((h) => h.endDate >= today);
  // Bar scale: this year's allowance plus any days carried in from last year.
  const total = balance.allowance + balance.carriedIn;
  const pct = total ? Math.min(100, (balance.used / total) * 100) : 0;
  const expiredPct = total ? Math.min(100 - pct, (balance.carriedExpired / total) * 100) : 0;
  const pendingPct = total ? Math.min(100 - pct - expiredPct, (balance.pending / total) * 100) : 0;

  return (
    <div>
      <PageHeader
        title={`Hi, ${me.name.split(" ")[0]}`}
        description={`Your leave overview for ${year}`}
        actions={
          <Link href="/leaves?new=1" className={buttonClass()}>
            + Request leave
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Remaining annual balance"
          value={
            <span className={balance.remaining < 0 ? "text-rose-700" : undefined}>
              {formatDays(balance.remaining)}
              <span className="ml-1 text-base font-normal text-zinc-500">days</span>
            </span>
          }
          hint={
            balance.carriedAvailable > 0
              ? `Includes ${formatDays(balance.carriedAvailable)} carried from ${year - 1}: use by ${formatDate(balance.carryExpiresOn)}`
              : balance.pending
                ? `${formatDays(balance.pending)} more days pending approval`
                : `${formatDays(balance.allowance)}-day allowance for ${year}`
          }
        />
        <StatCard label="Days used" value={formatDays(balance.used)} hint={`${data.settings.deductingTypes.join(" + ")} leave, approved`} />
        <StatCard label="Permission hours" value={formatHours(balance.permissionHours)} hint="Hourly permissions (Ozon) this year" />
        <StatCard
          label="Pending requests"
          value={mine.filter((l) => l.status === "Pending").length}
          hint={nextHoliday ? `Next holiday: ${nextHoliday.name}, ${formatShort(nextHoliday.startDate)}` : undefined}
        />
      </div>

      <Card className="mt-4 p-5">
        <div className="flex h-3 overflow-hidden rounded-full bg-zinc-100">
          <div className="bg-indigo-600" style={{ width: `${pct}%` }} title={`Used: ${formatDays(balance.used)}`} />
          <div className="bg-zinc-300" style={{ width: `${expiredPct}%` }} title={`Expired carried days: ${formatDays(balance.carriedExpired)}`} />
          <div className="pending-stripes bg-indigo-300" style={{ width: `${pendingPct}%` }} title={`Pending: ${formatDays(balance.pending)}`} />
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-500">
          <span>
            {formatDays(balance.allowance)} days for {year}
            {balance.carriedIn > 0 && ` + ${formatDays(balance.carriedIn)} carried from ${year - 1}`}
          </span>
          <span>■ Used {formatDays(balance.used)}</span>
          {balance.carriedExpired > 0 && <span className="text-zinc-400">■ Expired {formatDays(balance.carriedExpired)} carried</span>}
          <span>▨ Pending {formatDays(balance.pending)}</span>
          <span>□ Left after pending {formatDays(balance.available)}</span>
        </div>
        {balance.carriedAvailable > 0 && (
          <p className="mt-2 text-xs text-amber-700">
            {formatDays(balance.carriedAvailable)} carried-over day{balance.carriedAvailable === 1 ? "" : "s"} expire after{" "}
            {formatDate(balance.carryExpiresOn)}. Leave dated before then uses carried days first.
          </p>
        )}
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Upcoming & pending">
          <RequestList leaves={upcoming} data={data} nameOf={nameOf} empty="No upcoming leave. Enjoy work 🙂" />
        </Panel>
        <Panel title="Recent">
          <RequestList leaves={recent} data={data} nameOf={nameOf} empty="No past requests yet." />
        </Panel>
      </div>
    </div>
  );
}

function RequestList({
  leaves,
  data,
  nameOf,
  empty,
}: {
  leaves: AppData["leaves"];
  data: AppData;
  nameOf: (id: string) => string;
  empty: string;
}) {
  if (!leaves.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className="divide-y divide-zinc-100">
      {leaves.map((l) => (
        <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-900">
              {formatShort(l.startDate)}
              {l.endDate !== l.startDate && ` → ${formatShort(l.endDate)}`}
              <span className="font-normal text-zinc-500"> · {describeDuration(l, data)}</span>
            </p>
            <p className="text-xs text-zinc-500">
              {l.backupEmployeeId ? `Backup: ${nameOf(l.backupEmployeeId)}` : "No backup set"}
              {l.notes && ` · ${l.notes}`}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <TypeBadge type={l.type} />
            <StatusBadge status={l.status} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Panel({ title, tone, children }: { title: string; tone?: "warning"; children: React.ReactNode }) {
  return (
    <Card className={tone === "warning" ? "border-amber-300" : undefined}>
      <div className={tone === "warning" ? "rounded-t-xl border-b border-amber-200 bg-amber-50 px-5 py-3" : "border-b border-zinc-100 px-5 py-3"}>
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      </div>
      {children}
    </Card>
  );
}
