"use client";

import { useState } from "react";
import { Button, Card, cx, inputClass, Loading, PageHeader, StatCard, TypeBadge } from "@/components/ui";
import { addMonths, endOfMonth, formatDate, formatMonth, startOfMonth, todayISO } from "@/lib/dates";
import { exportCSV, exportExcel, type Cell } from "@/lib/export";
import {
  annualBalance,
  approved,
  calendarDays,
  employeeStats,
  formatDays,
  formatHours,
  leaveDays,
  leaveDaysWithin,
  leaveHours,
  overlapsRange,
  totalsByType,
  TYPE_STYLES,
} from "@/lib/leave";
import { useAppData } from "@/lib/store";
import { DURATION_LABELS, LEAVE_TYPES } from "@/lib/types";

type PeriodKind = "month" | "year" | "custom";

export default function ReportsPage() {
  const data = useAppData();
  const [kind, setKind] = useState<PeriodKind>("month");
  const [monthAnchor, setMonthAnchor] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  if (!data) return <Loading />;
  const { employees, leaves, settings } = data;
  const cal = data;
  const today = todayISO();

  const month = monthAnchor ?? startOfMonth(today);
  const yr = year ?? Number(today.slice(0, 4));
  let from: string, to: string, label: string;
  if (kind === "month") {
    from = startOfMonth(month);
    to = endOfMonth(month);
    label = formatMonth(month);
  } else if (kind === "year") {
    from = `${yr}-01-01`;
    to = `${yr}-12-31`;
    label = String(yr);
  } else {
    from = customFrom || startOfMonth(today);
    to = customTo && customTo >= from ? customTo : endOfMonth(from);
    label = `${formatDate(from)} – ${formatDate(to)}`;
  }

  const stats = employeeStats(employees, leaves, from, to, cal)
    .filter((s) => s.employee.active || s.occasions > 0 || s.permissions > 0)
    .sort((a, b) => b.days - a.days || a.employee.name.localeCompare(b.employee.name));
  const byType = totalsByType(stats);
  const totalOccasions = stats.reduce((s, x) => s + x.occasions, 0);
  const totalDays = stats.reduce((s, x) => s + x.days, 0);
  const totalPermissions = stats.reduce((s, x) => s + x.permissions, 0);
  const totalHours = stats.reduce((s, x) => s + x.permissionHours, 0);
  const balanceYear = Number(to.slice(0, 4));
  const membersWithLeave = stats.filter((s) => s.occasions > 0).length;
  const maxDays = Math.max(1, ...stats.map((s) => s.days));
  const periodLeaves = approved(leaves)
    .filter((l) => overlapsRange(l, from, to))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const excludedCount = leaves.filter((l) => l.status !== "Approved" && overlapsRange(l, from, to)).length;

  const summaryRows = (): Cell[][] => [
    [
      "Employee",
      "Department",
      "Status",
      "Total Occasions",
      "Total Days",
      ...LEAVE_TYPES.flatMap((t) => [`${t} Occasions`, `${t} Days`]),
      "Permissions",
      "Permission Hours",
    ],
    ...stats.map((s) => [
      s.employee.name,
      s.employee.department,
      s.employee.active ? "Active" : "Inactive",
      s.occasions,
      s.days,
      ...LEAVE_TYPES.flatMap((t) => [s.byType[t].occasions, s.byType[t].days]),
      s.permissions,
      s.permissionHours,
    ]),
    [
      "TOTAL",
      "",
      "",
      totalOccasions,
      totalDays,
      ...LEAVE_TYPES.flatMap((t) => [byType[t].occasions, byType[t].days]),
      totalPermissions,
      totalHours,
    ],
  ];

  const detailRows = (): Cell[][] => [
    [
      "Employee",
      "Leave Type",
      "Duration Type",
      "Start Date",
      "End Date",
      "Total Leave Days",
      "Days In Period",
      "Permission Hours",
      "Calendar Days",
      "Backup Person",
      "Notes",
    ],
    ...periodLeaves.map((l) => [
      employees.find((e) => e.id === l.employeeId)?.name ?? "Unknown",
      l.type,
      DURATION_LABELS[l.durationType],
      l.startDate,
      l.endDate,
      leaveDays(l, cal),
      leaveDaysWithin(l, from, to, cal),
      leaveHours(l),
      calendarDays(l.startDate, l.endDate),
      l.backupEmployeeId ? (employees.find((e) => e.id === l.backupEmployeeId)?.name ?? "") : "",
      l.notes,
    ]),
  ];

  const byTypeRows = (): Cell[][] => [
    ["Leave Type", "Occasions", "Days"],
    ...LEAVE_TYPES.map((t) => [t, byType[t].occasions, byType[t].days]),
    ["TOTAL", totalOccasions, totalDays],
  ];

  const balanceRows = (): Cell[][] => [
    [
      "Employee",
      "Department",
      "Status",
      "Annual Allowance",
      `Carried from ${balanceYear - 1}`,
      "Carried Used (Q1)",
      "Carried Expired",
      "Used (approved)",
      "Used from Allowance",
      "Pending",
      "Remaining",
      "Available after Pending",
      "Permission Hours",
    ],
    ...employees
      .filter((e) => e.active)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => {
        const b = annualBalance(e, leaves, balanceYear, cal);
        return [
          e.name,
          e.department,
          e.active ? "Active" : "Inactive",
          b.allowance,
          b.carriedIn,
          b.carriedUsed,
          b.carriedExpired,
          b.used,
          b.allowanceUsed,
          b.pending,
          b.remaining,
          b.available,
          b.permissionHours,
        ];
      }),
  ];

  const fileBase = `leave-report_${from}_to_${to}`;

  return (
    <div>
      <PageHeader
        title="Statistics & Export"
        description="Based on APPROVED leaves only. Pending and rejected requests are excluded."
        actions={
          <>
            <Button variant="secondary" onClick={() => exportCSV(`${fileBase}.csv`, summaryRows())}>
              Export CSV
            </Button>
            <Button
              onClick={() =>
                exportExcel(`${fileBase}.xls`, [
                  { name: "Summary by Employee", rows: summaryRows() },
                  { name: "By Leave Type", rows: byTypeRows() },
                  { name: "Approved Leaves", rows: detailRows() },
                  { name: `Balances ${balanceYear}`, rows: balanceRows() },
                ])
              }
            >
              Export Excel
            </Button>
          </>
        }
      />

      <Card className="mb-6 flex flex-col gap-3 p-4 md:flex-row md:items-center">
        <div className="inline-flex rounded-lg bg-zinc-100 p-1 text-sm">
          {(["month", "year", "custom"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cx(
                "rounded-md px-3 py-1 font-medium capitalize",
                kind === k ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800",
              )}
            >
              {k}
            </button>
          ))}
        </div>
        {kind === "month" && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setMonthAnchor(addMonths(month, -1))}>
              ←
            </Button>
            <span className="min-w-36 text-center font-medium">{label}</span>
            <Button size="sm" variant="secondary" onClick={() => setMonthAnchor(addMonths(month, 1))}>
              →
            </Button>
          </div>
        )}
        {kind === "year" && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setYear(yr - 1)}>
              ←
            </Button>
            <span className="min-w-16 text-center font-medium">{yr}</span>
            <Button size="sm" variant="secondary" onClick={() => setYear(yr + 1)}>
              →
            </Button>
          </div>
        )}
        {kind === "custom" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input type="date" className={cx(inputClass, "w-auto")} value={customFrom || from} onChange={(e) => setCustomFrom(e.target.value)} />
            <span className="text-zinc-500">to</span>
            <input type="date" className={cx(inputClass, "w-auto")} value={customTo || to} min={from} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        )}
        {excludedCount > 0 && (
          <span className="text-xs text-zinc-500 md:ml-auto">
            {excludedCount} pending/rejected request{excludedCount === 1 ? "" : "s"} in this period not counted
          </span>
        )}
      </Card>

      <div className="mb-6 rounded-xl border border-indigo-100 bg-indigo-50 px-5 py-4 text-sm text-indigo-900">
        <p className="font-semibold">How these numbers are counted</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-indigo-800">
          <li>
            <strong>Occasions</strong> = number of separate approved leave records (a 5-day holiday is 1 occasion).
          </li>
          <li>
            <strong>Days</strong> = working days actually taken; weekends and public holidays (configured in Settings) are not counted.
            A half day counts as 0.5.
          </li>
          <li>
            <strong>Hourly permissions (Ozon)</strong> are tracked as hours, separately — they are not occasions and never reduce the annual
            balance.
          </li>
          <li>A leave that crosses the period boundary counts as 1 occasion, but only the days inside the period are counted.</li>
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Leave occasions" value={totalOccasions} hint="Separate approved leave records" />
        <StatCard label="Total leave days" value={formatDays(totalDays)} hint="Working days off in the period" />
        <StatCard
          label="Permission hours"
          value={formatHours(totalHours)}
          hint={`${totalPermissions} hourly permission${totalPermissions === 1 ? "" : "s"} · ≈ ${formatDays(totalHours / (settings.hoursPerDay || 8))} day-equivalents`}
        />
        <StatCard
          label="Avg. days per occasion"
          value={totalOccasions ? (totalDays / totalOccasions).toFixed(1) : "—"}
          hint="Total days ÷ occasions"
        />
        <StatCard label="Members with leave" value={membersWithLeave} hint={`of ${stats.length} shown`} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card>
          <div className="border-b border-zinc-100 px-5 py-3">
            <h2 className="text-sm font-semibold">By leave type</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-5 py-2 font-medium">Type</th>
                <th className="px-5 py-2 text-right font-medium">Occasions</th>
                <th className="px-5 py-2 text-right font-medium">Days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {LEAVE_TYPES.map((t) => (
                <tr key={t}>
                  <td className="px-5 py-2.5">
                    <TypeBadge type={t} />
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{byType[t].occasions}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{formatDays(byType[t].days)}</td>
                </tr>
              ))}
              <tr className="bg-zinc-50 font-semibold">
                <td className="px-5 py-2.5">Total</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{totalOccasions}</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{formatDays(totalDays)}</td>
              </tr>
            </tbody>
          </table>
          {totalDays > 0 && (
            <div className="px-5 pb-5 pt-2">
              <div className="flex h-3 overflow-hidden rounded-full bg-zinc-100">
                {LEAVE_TYPES.map((t) => (
                  <div
                    key={t}
                    className={TYPE_STYLES[t].dot}
                    style={{ width: `${(byType[t].days / totalDays) * 100}%` }}
                    title={`${t}: ${byType[t].days} days`}
                  />
                ))}
              </div>
              <p className="mt-1.5 text-xs text-zinc-500">Share of leave days by type</p>
            </div>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <div className="border-b border-zinc-100 px-5 py-3">
            <h2 className="text-sm font-semibold">By team member — {label}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Member</th>
                  <th className="px-4 py-2 text-right font-medium">Occasions</th>
                  <th className="px-4 py-2 text-right font-medium">Days</th>
                  {LEAVE_TYPES.map((t) => (
                    <th key={t} className="px-3 py-2 text-right font-medium" title={`${t}: occasions / days`}>
                      {t}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium" title="Hourly permissions">
                    Hours
                  </th>
                  <th className="w-40 px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {stats.map((s) => (
                  <tr key={s.employee.id} className={cx(s.occasions === 0 && "text-zinc-400")}>
                    <td className="px-4 py-2.5">
                      <span className={cx("font-medium", s.occasions ? "text-zinc-900" : "text-zinc-400")}>{s.employee.name}</span>
                      {!s.employee.active && <span className="ml-1 text-xs text-zinc-400">(inactive)</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{s.occasions}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatDays(s.days)}</td>
                    {LEAVE_TYPES.map((t) => (
                      <td key={t} className="px-3 py-2.5 text-right tabular-nums text-zinc-500">
                        {s.byType[t].occasions ? `${s.byType[t].occasions} / ${formatDays(s.byType[t].days)}d` : "—"}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-500">
                      {s.permissionHours ? formatHours(s.permissionHours) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex h-2 overflow-hidden rounded-full bg-zinc-100">
                        {LEAVE_TYPES.map((t) => (
                          <div key={t} className={TYPE_STYLES[t].dot} style={{ width: `${(s.byType[t].days / maxDays) * 100}%` }} />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">Type columns show occasions / days.</p>
        </Card>
      </div>
    </div>
  );
}
