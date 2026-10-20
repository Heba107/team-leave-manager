import { dayOfWeek, diffDays, eachDay, maxISO, minISO } from "./dates";
import type { Employee, Leave, LeaveType, Settings } from "./types";
import { LEAVE_TYPES } from "./types";

/** Number of leave days (excluding configured weekend days) between two dates, inclusive. */
export function countLeaveDays(startISO: string, endISO: string, settings: Settings): number {
  if (!startISO || !endISO || endISO < startISO) return 0;
  return eachDay(startISO, endISO).filter((d) => !settings.weekendDays.includes(dayOfWeek(d))).length;
}

export function calendarDays(startISO: string, endISO: string): number {
  if (!startISO || !endISO || endISO < startISO) return 0;
  return diffDays(startISO, endISO) + 1;
}

export function leaveDays(leave: Leave, settings: Settings): number {
  return countLeaveDays(leave.startDate, leave.endDate, settings);
}

/** Leave days that fall inside [fromISO, toISO]. Used so a leave spanning two months is split correctly. */
export function leaveDaysWithin(leave: Leave, fromISO: string, toISO: string, settings: Settings): number {
  const s = maxISO(leave.startDate, fromISO);
  const e = minISO(leave.endDate, toISO);
  return countLeaveDays(s, e, settings);
}

export function overlapsRange(leave: Leave, fromISO: string, toISO: string): boolean {
  return leave.startDate <= toISO && leave.endDate >= fromISO;
}

export function isOnLeave(leave: Leave, dayISO: string): boolean {
  return leave.startDate <= dayISO && leave.endDate >= dayISO;
}

export function rangesOverlap(a: Leave, b: Leave): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/** Leaves that count towards statistics and occupancy. */
export const approved = (leaves: Leave[]) => leaves.filter((l) => l.status === "Approved");
/** Leaves that block time on the calendar (approved + still pending). */
export const active = (leaves: Leave[]) => leaves.filter((l) => l.status !== "Rejected");

/** Same employee, overlapping dates, not rejected — used to block duplicate requests. */
export function findSelfConflict(candidate: Leave, leaves: Leave[]): Leave | undefined {
  return active(leaves).find(
    (l) => l.id !== candidate.id && l.employeeId === candidate.employeeId && rangesOverlap(l, candidate),
  );
}

/** Other employees whose (non-rejected) leaves overlap the candidate's dates. */
export function findTeamOverlaps(candidate: Leave, leaves: Leave[]): Leave[] {
  return active(leaves).filter(
    (l) => l.id !== candidate.id && l.employeeId !== candidate.employeeId && rangesOverlap(l, candidate),
  );
}

export interface OverlapGroup {
  startDate: string;
  endDate: string;
  leaves: Leave[];
}

/**
 * Groups non-rejected leaves (from different employees) whose date ranges overlap,
 * restricted to those ending on/after `fromISO`. Each group is a period during which
 * two or more people are off at the same time.
 */
export function overlapGroups(leaves: Leave[], fromISO: string): OverlapGroup[] {
  const relevant = active(leaves)
    .filter((l) => l.endDate >= fromISO)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const groups: OverlapGroup[] = [];
  for (let i = 0; i < relevant.length; i++) {
    for (let j = i + 1; j < relevant.length; j++) {
      const a = relevant[i];
      const b = relevant[j];
      if (b.startDate > a.endDate) break;
      if (a.employeeId === b.employeeId) continue;
      const startDate = maxISO(a.startDate, b.startDate);
      const endDate = minISO(a.endDate, b.endDate);
      const existing = groups.find((g) => g.startDate <= endDate && startDate <= g.endDate);
      if (existing) {
        existing.startDate = minISO(existing.startDate, startDate);
        existing.endDate = maxISO(existing.endDate, endDate);
        for (const l of [a, b]) if (!existing.leaves.includes(l)) existing.leaves.push(l);
      } else {
        groups.push({ startDate, endDate, leaves: [a, b] });
      }
    }
  }
  return groups.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export interface EmployeeStats {
  employee: Employee;
  occasions: number;
  days: number;
  byType: Record<LeaveType, { occasions: number; days: number }>;
}

function emptyByType(): Record<LeaveType, { occasions: number; days: number }> {
  return Object.fromEntries(LEAVE_TYPES.map((t) => [t, { occasions: 0, days: 0 }])) as Record<
    LeaveType,
    { occasions: number; days: number }
  >;
}

/**
 * Per-employee statistics for APPROVED leaves overlapping [fromISO, toISO].
 * - occasions: number of separate leave records touching the period
 * - days: leave days that actually fall inside the period
 */
export function employeeStats(
  employees: Employee[],
  leaves: Leave[],
  fromISO: string,
  toISO: string,
  settings: Settings,
): EmployeeStats[] {
  const inPeriod = approved(leaves).filter((l) => overlapsRange(l, fromISO, toISO));
  return employees.map((employee) => {
    const byType = emptyByType();
    let occasions = 0;
    let days = 0;
    for (const l of inPeriod) {
      if (l.employeeId !== employee.id) continue;
      const d = leaveDaysWithin(l, fromISO, toISO, settings);
      occasions++;
      days += d;
      byType[l.type].occasions++;
      byType[l.type].days += d;
    }
    return { employee, occasions, days, byType };
  });
}

export function totalsByType(stats: EmployeeStats[]) {
  const byType = emptyByType();
  for (const s of stats) {
    for (const t of LEAVE_TYPES) {
      byType[t].occasions += s.byType[t].occasions;
      byType[t].days += s.byType[t].days;
    }
  }
  return byType;
}

export const TYPE_STYLES: Record<LeaveType, { chip: string; bar: string; dot: string }> = {
  Annual: {
    chip: "bg-sky-100 text-sky-800 ring-sky-200",
    bar: "bg-sky-500 text-white",
    dot: "bg-sky-500",
  },
  Sick: {
    chip: "bg-amber-100 text-amber-800 ring-amber-200",
    bar: "bg-amber-500 text-white",
    dot: "bg-amber-500",
  },
  Emergency: {
    chip: "bg-rose-100 text-rose-800 ring-rose-200",
    bar: "bg-rose-500 text-white",
    dot: "bg-rose-500",
  },
};

export const STATUS_STYLES = {
  Pending: "bg-yellow-50 text-yellow-800 ring-yellow-200",
  Approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  Rejected: "bg-zinc-100 text-zinc-600 ring-zinc-200",
} as const;
