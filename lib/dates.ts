// All dates are handled as "YYYY-MM-DD" strings and computed in UTC so that
// day arithmetic is never affected by the browser's time zone or DST.

const DAY_MS = 86_400_000;

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function todayISO(): string {
  const now = new Date();
  return toISO(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function addDays(iso: string, days: number): string {
  return toISO(new Date(parseISO(iso).getTime() + days * DAY_MS));
}

export function diffDays(fromISO: string, toISOStr: string): number {
  return Math.round((parseISO(toISOStr).getTime() - parseISO(fromISO).getTime()) / DAY_MS);
}

export function dayOfWeek(iso: string): number {
  return parseISO(iso).getUTCDay();
}

export function startOfMonth(iso: string): string {
  return iso.slice(0, 8) + "01";
}

export function endOfMonth(iso: string): string {
  const d = parseISO(iso);
  return toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

export function addMonths(iso: string, months: number): string {
  const d = parseISO(startOfMonth(iso));
  return toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1)));
}

/** Start of the week containing `iso`, with weeks starting on `weekStart`. */
export function startOfWeek(iso: string, weekStart: number): string {
  const offset = (dayOfWeek(iso) - weekStart + 7) % 7;
  return addDays(iso, -offset);
}

export function eachDay(startISO: string, endISO: string): string[] {
  const days: string[] = [];
  for (let d = startISO; d <= endISO; d = addDays(d, 1)) days.push(d);
  return days;
}

export function maxISO(a: string, b: string): string {
  return a > b ? a : b;
}

export function minISO(a: string, b: string): string {
  return a < b ? a : b;
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const fmtDate = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const fmtMonth = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const fmtShort = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function formatDate(iso: string): string {
  return fmtDate.format(parseISO(iso));
}

export function formatMonth(iso: string): string {
  return fmtMonth.format(parseISO(iso));
}

export function formatShort(iso: string): string {
  return fmtShort.format(parseISO(iso));
}
