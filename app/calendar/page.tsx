"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card, cx, Loading, PageHeader } from "@/components/ui";
import {
  addDays,
  addMonths,
  dayOfWeek,
  eachDay,
  endOfMonth,
  formatDate,
  formatMonth,
  formatShort,
  startOfMonth,
  startOfWeek,
  todayISO,
  WEEKDAY_SHORT,
} from "@/lib/dates";
import { describeDuration, holidayOn, isOnLeave, TYPE_STYLES } from "@/lib/leave";
import { useAppData } from "@/lib/store";
import type { AppData, Leave } from "@/lib/types";
import { LEAVE_TYPES } from "@/lib/types";

const WEEK_START = 0; // Sunday

type View = "month" | "week";

export default function CalendarPage() {
  const data = useAppData();
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [showPending, setShowPending] = useState(true);
  const [employeeFilter, setEmployeeFilter] = useState("");

  if (!data) return <Loading />;

  const today = todayISO();
  const current = anchor ?? today;
  const admin = data.me.role === "admin";
  const visibleLeaves = data.leaves.filter(
    (l) =>
      (l.status === "Approved" || (showPending && l.status === "Pending")) &&
      (!employeeFilter || l.employeeId === employeeFilter),
  );

  const step = (dir: 1 | -1) => setAnchor(view === "month" ? addMonths(current, dir) : addDays(current, 7 * dir));
  const title =
    view === "month"
      ? formatMonth(current)
      : `${formatShort(startOfWeek(current, WEEK_START))} – ${formatDate(addDays(startOfWeek(current, WEEK_START), 6))}`;

  return (
    <div>
      <PageHeader
        title={admin ? "Leave Calendar" : "My Calendar"}
        description={
          admin
            ? "Approved leaves, plus pending requests (striped). Days with two or more people off are flagged."
            : "Your approved and pending leave, with public holidays."
        }
      />

      <Card className="mb-4 flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => step(-1)} aria-label="Previous">
            ←
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAnchor(null)}>
            Today
          </Button>
          <Button variant="secondary" size="sm" onClick={() => step(1)} aria-label="Next">
            →
          </Button>
          <h2 className="ml-2 text-lg font-semibold text-zinc-900">{title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {admin && (
          <select
            className="rounded-lg border-0 bg-white px-3 py-1.5 text-sm ring-1 ring-inset ring-zinc-300"
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
          >
            <option value="">All members</option>
            {data.employees
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
          )}
          <label className="flex items-center gap-2 text-zinc-600">
            <input type="checkbox" checked={showPending} onChange={(e) => setShowPending(e.target.checked)} className="accent-indigo-600" />
            Show pending
          </label>
          <div className="inline-flex rounded-lg bg-zinc-100 p-1">
            {(["month", "week"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cx(
                  "rounded-md px-3 py-1 font-medium capitalize",
                  view === v ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Legend />

      {view === "month" ? (
        <MonthView data={data} leaves={visibleLeaves} anchor={current} today={today} />
      ) : (
        <WeekView data={data} leaves={visibleLeaves} anchor={current} today={today} employeeFilter={employeeFilter} />
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-zinc-600">
      {LEAVE_TYPES.map((t) => (
        <span key={t} className="flex items-center gap-1.5">
          <span className={cx("h-3 w-3 rounded-sm", TYPE_STYLES[t].dot)} /> {t}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="pending-stripes h-3 w-3 rounded-sm bg-zinc-400" /> Pending
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm bg-amber-100 ring-2 ring-amber-400" /> Overlap (2+ people off)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm bg-zinc-100" /> Weekend
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm bg-violet-100 ring-1 ring-violet-300" /> Public holiday
      </span>
      <span className="text-zinc-500">½ = half day · h = hourly permission</span>
    </div>
  );
}

function peopleOff(leaves: Leave[], day: string) {
  return leaves.filter((l) => isOnLeave(l, day));
}

/** People away for at least half a day (hourly permissions don't count towards overlap alerts). */
function awayCount(leaves: Leave[], day: string) {
  return new Set(peopleOff(leaves, day).filter((l) => l.durationType !== "hourly").map((l) => l.employeeId)).size;
}

function shortDuration(l: Leave) {
  if (l.durationType === "hourly") return ` ${l.hours ?? ""}h`;
  if (l.durationType === "half_am") return " ½AM";
  if (l.durationType === "half_pm") return " ½PM";
  return "";
}

function LeaveChip({ leave, name, data }: { leave: Leave; name: string; data: AppData }) {
  return (
    <div
      title={`${name} · ${leave.type} · ${leave.status}\n${formatDate(leave.startDate)} → ${formatDate(leave.endDate)} (${describeDuration(leave, data)})${leave.notes ? `\n${leave.notes}` : ""}`}
      className={cx(
        "truncate rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight",
        TYPE_STYLES[leave.type].bar,
        leave.status === "Pending" && "pending-stripes opacity-80",
        leave.durationType === "hourly" && "opacity-70",
      )}
    >
      {name}
      {shortDuration(leave)}
    </div>
  );
}

function MonthView({ data, leaves, anchor, today }: { data: AppData; leaves: Leave[]; anchor: string; today: string }) {
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const gridStart = startOfWeek(monthStart, WEEK_START);
  const gridEnd = addDays(startOfWeek(monthEnd, WEEK_START), 6);
  const days = eachDay(gridStart, gridEnd);
  const firstName = (id: string) =>
    (data.employees.find((e) => e.id === id)?.name ?? data.directory.find((e) => e.id === id)?.name ?? "?").split(" ")[0];
  const MAX_CHIPS = 3;

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 text-center text-xs font-medium uppercase tracking-wide text-zinc-500">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="py-2">
            {WEEKDAY_SHORT[(i + WEEK_START) % 7]}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const off = peopleOff(leaves, day);
          const distinct = awayCount(leaves, day);
          const inMonth = day >= monthStart && day <= monthEnd;
          const weekend = data.settings.weekendDays.includes(dayOfWeek(day));
          const holiday = holidayOn(day, data.holidays);
          const overlap = distinct >= 2;
          return (
            <div
              key={day}
              className={cx(
                "group relative min-h-24 border-b border-r border-zinc-100 p-1.5 sm:min-h-28",
                !inMonth && "bg-zinc-50/70 text-zinc-400",
                inMonth && weekend && "bg-zinc-50",
                inMonth && holiday && "bg-violet-50",
                overlap && "bg-amber-50 ring-2 ring-inset ring-amber-400",
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={cx(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                    day === today ? "bg-indigo-600 text-white" : inMonth ? "text-zinc-700" : "text-zinc-400",
                  )}
                >
                  {Number(day.slice(8))}
                </span>
                {overlap && (
                  <span className="rounded bg-amber-200 px-1 text-[10px] font-semibold text-amber-900" title={`${distinct} people off`}>
                    ⚠ {distinct}
                  </span>
                )}
                <Link
                  href={`/leaves?new=1&date=${day}`}
                  className="hidden h-5 w-5 items-center justify-center rounded text-xs text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 group-hover:flex"
                  title="Add leave on this day"
                >
                  +
                </Link>
              </div>
              {holiday && (
                <div className="mb-0.5 truncate px-1 text-[10px] font-medium text-violet-700" title={holiday.name}>
                  🎉 {holiday.name}
                </div>
              )}
              <div className="space-y-0.5">
                {off.slice(0, MAX_CHIPS).map((l) => (
                  <LeaveChip key={l.id} leave={l} name={firstName(l.employeeId)} data={data} />
                ))}
                {off.length > MAX_CHIPS && (
                  <div
                    className="px-1 text-[11px] text-zinc-500"
                    title={off.slice(MAX_CHIPS).map((l) => firstName(l.employeeId)).join(", ")}
                  >
                    +{off.length - MAX_CHIPS} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function WeekView({
  data,
  leaves,
  anchor,
  today,
  employeeFilter,
}: {
  data: AppData;
  leaves: Leave[];
  anchor: string;
  today: string;
  employeeFilter: string;
}) {
  const start = startOfWeek(anchor, WEEK_START);
  const days = eachDay(start, addDays(start, 6));
  const people = data.employees
    .filter((e) => (employeeFilter ? e.id === employeeFilter : e.active || leaves.some((l) => l.employeeId === e.id && l.endDate >= start && l.startDate <= days[6])))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[720px] table-fixed text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
            <th className="w-44 px-3 py-2 text-left font-medium uppercase tracking-wide">Member</th>
            {days.map((d) => {
              const count = awayCount(leaves, d);
              const holiday = holidayOn(d, data.holidays);
              return (
                <th
                  key={d}
                  className={cx(
                    "px-1 py-2 font-medium",
                    data.settings.weekendDays.includes(dayOfWeek(d)) && "bg-zinc-100",
                    holiday && "bg-violet-50 text-violet-800",
                    count >= 2 && "bg-amber-100 text-amber-900",
                  )}
                >
                  <div className="uppercase">{WEEKDAY_SHORT[dayOfWeek(d)]}</div>
                  <div className={cx("mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-sm", d === today && "bg-indigo-600 text-white")}>
                    {Number(d.slice(8))}
                  </div>
                  {holiday && <div className="mt-0.5 truncate text-[10px] font-semibold" title={holiday.name}>🎉 {holiday.name}</div>}
                  {count >= 2 && <div className="mt-0.5 text-[10px] font-semibold">⚠ {count} off</div>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {people.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-10 text-center text-zinc-500">
                No team members to show.
              </td>
            </tr>
          )}
          {people.map((p) => (
            <tr key={p.id}>
              <td className="truncate px-3 py-2 font-medium text-zinc-800">
                {p.name}
                {!p.active && <span className="ml-1 text-xs font-normal text-zinc-400">(inactive)</span>}
              </td>
              {days.map((d) => {
                const l = leaves.find((x) => x.employeeId === p.id && isOnLeave(x, d));
                const weekend = data.settings.weekendDays.includes(dayOfWeek(d));
                const count = awayCount(leaves, d);
                const holiday = holidayOn(d, data.holidays);
                return (
                  <td key={d} className={cx("h-11 px-0.5 py-1", weekend && "bg-zinc-50", holiday && "bg-violet-50", count >= 2 && l && "bg-amber-50")}>
                    {l && (
                      <div
                        title={`${l.type} · ${l.status} · ${describeDuration(l, data)}\n${formatDate(l.startDate)} → ${formatDate(l.endDate)}${l.notes ? `\n${l.notes}` : ""}`}
                        className={cx(
                          "flex h-full items-center justify-center truncate text-[11px] font-medium",
                          TYPE_STYLES[l.type].bar,
                          l.status === "Pending" && "pending-stripes opacity-80",
                          d === l.startDate || d === days[0] ? "rounded-l-md" : "",
                          d === l.endDate || d === days[6] ? "rounded-r-md" : "",
                          count >= 2 && l.durationType !== "hourly" && "ring-2 ring-amber-400",
                          l.durationType === "hourly" && "opacity-70",
                        )}
                      >
                        {(d === l.startDate || d === days[0]) && `${l.type}${shortDuration(l)}`}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
