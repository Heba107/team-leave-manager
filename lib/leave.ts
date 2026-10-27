import { dayOfWeek, diffDays, eachDay, maxISO, minISO, todayISO } from "./dates";
import type { Calendar, DurationType, Employee, Holiday, Leave, LeaveType } from "./types";
import { LEAVE_TYPES } from "./types";

export function holidayOn(day: string, holidays: Holiday[]): Holiday | undefined {
  return holidays.find((h) => h.startDate <= day && h.endDate >= day);
}

export function isWorkingDay(day: string, cal: Calendar): boolean {
  return !cal.settings.weekendDays.includes(dayOfWeek(day)) && !holidayOn(day, cal.holidays);
}

/** Working days (excluding weekends and public holidays) between two dates, inclusive. */
export function countLeaveDays(startISO: string, endISO: string, cal: Calendar): number {
  if (!startISO || !endISO || endISO < startISO) return 0;
  return eachDay(startISO, endISO).filter((d) => isWorkingDay(d, cal)).length;
}

export function calendarDays(startISO: string, endISO: string): number {
  if (!startISO || !endISO || endISO < startISO) return 0;
  return diffDays(startISO, endISO) + 1;
}

/** Days a record counts for: full days, 0.5 per half day, 0 for hourly permissions. */
export function durationFactor(type: DurationType): number {
  return type === "full" ? 1 : type === "hourly" ? 0 : 0.5;
}

type LeaveShape = Pick<Leave, "startDate" | "endDate" | "durationType">;

export function leaveDays(leave: LeaveShape, cal: Calendar): number {
  return countLeaveDays(leave.startDate, leave.endDate, cal) * durationFactor(leave.durationType);
}

/** Leave days that fall inside [fromISO, toISO]. Used so a leave spanning two months is split correctly. */
export function leaveDaysWithin(leave: LeaveShape, fromISO: string, toISO: string, cal: Calendar): number {
  const s = maxISO(leave.startDate, fromISO);
  const e = minISO(leave.endDate, toISO);
  return countLeaveDays(s, e, cal) * durationFactor(leave.durationType);
}

export function leaveHours(leave: Pick<Leave, "durationType" | "hours">): number {
  return leave.durationType === "hourly" ? (leave.hours ?? 0) : 0;
}

/** Hours between two "HH:MM" times, rounded to a quarter hour. */
export function hoursBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const mins = eh * 60 + em - (sh * 60 + sm);
  return mins > 0 ? Math.round(mins / 15) / 4 : 0;
}

export function formatDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function formatHours(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, "")}h`;
}

/** Short human description of a record's duration, e.g. "3 days", "½ day (AM)", "2h permission". */
export function describeDuration(leave: Leave, cal: Calendar): string {
  if (leave.durationType === "hourly") {
    const time = leave.startTime && leave.endTime ? ` (${leave.startTime.slice(0, 5)}–${leave.endTime.slice(0, 5)})` : "";
    return `${formatHours(leave.hours ?? 0)} permission${time}`;
  }
  if (leave.durationType !== "full") return `½ day (${leave.durationType === "half_am" ? "AM" : "PM"})`;
  const d = leaveDays(leave, cal);
  return `${formatDays(d)} day${d === 1 ? "" : "s"}`;
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

/** Mirrors the database rule in check_leave_overlap(): two partial-day records on the same day may coexist. */
export function conflicts(a: Leave, b: Leave): boolean {
  if (!rangesOverlap(a, b)) return false;
  if (a.durationType === "full" || b.durationType === "full") return true;
  if (a.durationType === b.durationType && a.durationType !== "hourly") return true;
  if (a.durationType === "hourly" && b.durationType === "hourly" && a.startTime && b.startTime && a.endTime && b.endTime)
    return a.startTime < b.endTime && b.startTime < a.endTime;
  return false;
}

/** Leaves that count towards statistics and occupancy. */
export const approved = (leaves: Leave[]) => leaves.filter((l) => l.status === "Approved");
/** Leaves that block time on the calendar (approved + still pending). */
export const active = (leaves: Leave[]) => leaves.filter((l) => l.status !== "Rejected");

/** Same employee, conflicting dates, not rejected — used to block duplicate requests. */
export function findSelfConflict(candidate: Leave, leaves: Leave[]): Leave | undefined {
  return active(leaves).find((l) => l.id !== candidate.id && l.employeeId === candidate.employeeId && conflicts(l, candidate));
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
 * two or more people are off at the same time. Hourly permissions are ignored.
 */
export function overlapGroups(leaves: Leave[], fromISO: string): OverlapGroup[] {
  const relevant = active(leaves)
    .filter((l) => l.endDate >= fromISO && l.durationType !== "hourly")
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

type TypeTotals = Record<LeaveType, { occasions: number; days: number }>;

export interface EmployeeStats {
  employee: Employee;
  /** Separate approved day-leave records (half days included, permissions excluded). */
  occasions: number;
  days: number;
  /** Hourly permissions, tracked separately from days. */
  permissions: number;
  permissionHours: number;
  byType: TypeTotals;
}

function emptyByType(): TypeTotals {
  return Object.fromEntries(LEAVE_TYPES.map((t) => [t, { occasions: 0, days: 0 }])) as TypeTotals;
}

/**
 * Per-employee statistics for APPROVED leaves overlapping [fromISO, toISO].
 * - occasions: number of separate day-leave records touching the period
 * - days: leave days that actually fall inside the period (half day = 0.5)
 * - permissions / permissionHours: hourly permissions, never counted as days
 */
export function employeeStats(
  employees: Employee[],
  leaves: Leave[],
  fromISO: string,
  toISO: string,
  cal: Calendar,
): EmployeeStats[] {
  const inPeriod = approved(leaves).filter((l) => overlapsRange(l, fromISO, toISO));
  return employees.map((employee) => {
    const byType = emptyByType();
    let occasions = 0;
    let days = 0;
    let permissions = 0;
    let permissionHours = 0;
    for (const l of inPeriod) {
      if (l.employeeId !== employee.id) continue;
      if (l.durationType === "hourly") {
        permissions++;
        permissionHours += leaveHours(l);
        continue;
      }
      const d = leaveDaysWithin(l, fromISO, toISO, cal);
      occasions++;
      days += d;
      byType[l.type].occasions++;
      byType[l.type].days += d;
    }
    return { employee, occasions, days, permissions, permissionHours, byType };
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

/** Carried-over days can only be used for leave dated up to this day of the year (end of Q1). */
export const CARRY_EXPIRY_MMDD = "03-31";

/** Year whose starting balance can be overridden per person (the app was adopted in Oct 2026). */
export const OPENING_BALANCE_YEAR = 2026;

/** A person's own starting balance for `year`: the 2026 opening balance if set, else the allowance. */
export function yearAllowance(employee: Employee, year: number): number {
  return year === OPENING_BALANCE_YEAR && employee.openingBalance2026 != null ? employee.openingBalance2026 : employee.annualAllowance;
}

export interface Balance {
  year: number;
  /** Date the balance is calculated for (decides whether carried days are still valid). */
  asOf: string;
  /** Starting balance for the year: the allowance, or the 2026 opening balance if one is set. */
  allowance: number;
  /** True when `allowance` comes from the 2026 opening balance. */
  fromOpeningBalance: boolean;
  /** Unused days brought forward from the previous year on 1 January. */
  carriedIn: number;
  /** Carried days taken by approved leave dated in Q1. */
  carriedUsed: number;
  /** Carried days still usable (0 after the expiry date). */
  carriedAvailable: number;
  /** Carried days that lapsed unused after the expiry date. */
  carriedExpired: number;
  /** Last day carried days can be used, e.g. "2027-03-31". */
  carryExpiresOn: string;
  /** Approved days of deducting types dated in the year (carried + allowance). */
  used: number;
  /** Part of `used` charged to this year's allowance. */
  allowanceUsed: number;
  /** Pending days of deducting types dated in the year (not yet deducted). */
  pending: number;
  /** Days left now: this year's allowance not yet used + carried days still valid. */
  remaining: number;
  /** `remaining` once every pending request is approved. */
  available: number;
  permissionHours: number;
}

interface YearUsage {
  approved: number;
  approvedQ1: number;
  pending: number;
  pendingQ1: number;
  permissionHours: number;
}

/** Deducting days an employee's leaves use in `year`, split by Q1 (carry window) and status. */
function yearUsage(employee: Employee, leaves: Leave[], year: number, cal: Calendar): YearUsage {
  const from = `${year}-01-01`;
  const q1End = `${year}-${CARRY_EXPIRY_MMDD}`;
  const to = `${year}-12-31`;
  const u: YearUsage = { approved: 0, approvedQ1: 0, pending: 0, pendingQ1: 0, permissionHours: 0 };
  for (const l of leaves) {
    if (l.employeeId !== employee.id || !overlapsRange(l, from, to) || l.status === "Rejected") continue;
    if (l.durationType === "hourly") {
      if (l.status === "Approved") u.permissionHours += leaveHours(l);
      continue;
    }
    if (!cal.settings.deductingTypes.includes(l.type)) continue;
    // Days are charged to the year — and the quarter — their dates fall in.
    const days = leaveDaysWithin(l, from, to, cal);
    const q1 = leaveDaysWithin(l, from, q1End, cal);
    if (l.status === "Approved") {
      u.approved += days;
      u.approvedQ1 += q1;
    } else {
      u.pending += days;
      u.pendingQ1 += q1;
    }
  }
  return u;
}

/** Unused days carried into `year` from the previous year (approved leave only). */
export function carriedInto(employee: Employee, leaves: Leave[], year: number, cal: Calendar): number {
  const { carryForwardEnabled, carryForwardFromYear } = cal.settings;
  if (!carryForwardEnabled || year - 1 < carryForwardFromYear) return 0;
  // What the previous year had available from its own allowance: carried days it
  // received were used first in its Q1, and anything left of those expired.
  const prevCarry = carriedInto(employee, leaves, year - 1, cal);
  const prev = yearUsage(employee, leaves, year - 1, cal);
  const prevAllowanceUsed = prev.approved - Math.min(prevCarry, prev.approvedQ1);
  return Math.max(0, yearAllowance(employee, year - 1) - prevAllowanceUsed);
}

/**
 * Annual balance for one employee in calendar year `year`, as of `asOf`
 * (default: today within the current year, 1 Jan for future years, 31 Dec for past ones).
 *
 * Carry forward: unused days from the previous year arrive on 1 Jan, are used first by
 * leave dated in Q1, and expire after 31 March. Hourly permissions never deduct days.
 */
export function annualBalance(employee: Employee, leaves: Leave[], year: number, cal: Calendar, asOf?: string): Balance {
  const today = todayISO();
  const date =
    asOf ?? (today.startsWith(String(year)) ? today : String(year) > today.slice(0, 4) ? `${year}-01-01` : `${year}-12-31`);
  const carryExpiresOn = `${year}-${CARRY_EXPIRY_MMDD}`;
  const carryValid = date <= carryExpiresOn;

  const u = yearUsage(employee, leaves, year, cal);
  const carriedIn = carriedInto(employee, leaves, year, cal);
  const carriedUsed = Math.min(carriedIn, u.approvedQ1);
  const carriedLeft = carriedIn - carriedUsed;
  const allowanceUsed = u.approved - carriedUsed;
  const pendingFromCarry = Math.min(carriedLeft, u.pendingQ1);
  const pendingFromAllowance = u.pending - pendingFromCarry;

  const carriedAvailable = carryValid ? carriedLeft : 0;
  const allowance = yearAllowance(employee, year);
  const allowanceLeft = allowance - allowanceUsed;
  return {
    year,
    asOf: date,
    allowance,
    fromOpeningBalance: year === OPENING_BALANCE_YEAR && employee.openingBalance2026 != null,
    carriedIn,
    carriedUsed,
    carriedAvailable,
    carriedExpired: carryValid ? 0 : carriedLeft,
    carryExpiresOn,
    used: u.approved,
    allowanceUsed,
    pending: u.pending,
    remaining: allowanceLeft + carriedAvailable,
    available: allowanceLeft - pendingFromAllowance + (carryValid ? carriedLeft - pendingFromCarry : 0),
    permissionHours: u.permissionHours,
  };
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
