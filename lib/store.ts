"use client";

import { useSyncExternalStore } from "react";
import type { PostgrestError } from "@supabase/supabase-js";
import { addDays, startOfWeek, todayISO } from "./dates";
import { getSupabase } from "./supabase/client";
import type { Database } from "./supabase/database.types";
import type { AppData, Employee, Leave, Settings } from "./types";

type EmployeeRow = Database["public"]["Tables"]["employees"]["Row"];
type LeaveRow = Database["public"]["Tables"]["leaves"]["Row"];

/** Key used by the earlier localStorage-only version; read once to offer an import. */
export const LEGACY_STORAGE_KEY = "team-leave-manager:v1";

const DEFAULT_SETTINGS: Settings = { weekendDays: [5, 6] };
const PAGE_SIZE = 1000;

export interface StoreState {
  status: "idle" | "loading" | "ready" | "error";
  data: AppData | null;
  /** Fatal load error (shown instead of the page). */
  error: string | null;
  /** Non-fatal error from the last save (shown as a banner). */
  notice: string | null;
}

let state: StoreState = { status: "idle", data: null, error: null, notice: null };
const listeners = new Set<() => void>();
const SERVER_STATE: StoreState = state;

function setState(patch: Partial<StoreState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

// ---------------------------------------------------------------------------
// Row mapping (snake_case in Postgres, camelCase in the app)
// ---------------------------------------------------------------------------

const toEmployee = (r: EmployeeRow): Employee => ({
  id: r.id,
  name: r.name,
  email: r.email,
  department: r.department,
  position: r.position,
  active: r.active,
  createdAt: r.created_at,
});

const fromEmployee = (e: Employee) => ({
  id: e.id,
  name: e.name,
  email: e.email,
  department: e.department,
  position: e.position,
  active: e.active,
  created_at: e.createdAt,
});

const toLeave = (r: LeaveRow): Leave => ({
  id: r.id,
  employeeId: r.employee_id,
  type: r.type,
  startDate: r.start_date,
  endDate: r.end_date,
  status: r.status,
  notes: r.notes,
  createdAt: r.created_at,
});

const fromLeave = (l: Leave) => ({
  id: l.id,
  employee_id: l.employeeId,
  type: l.type,
  start_date: l.startDate,
  end_date: l.endDate,
  status: l.status,
  notes: l.notes,
  created_at: l.createdAt,
});

/** Converts the camelCase patch keys we use in the UI to column names. */
function leavePatch(patch: Partial<Omit<Leave, "id">>) {
  const out: Database["public"]["Tables"]["leaves"]["Update"] = {};
  if (patch.employeeId !== undefined) out.employee_id = patch.employeeId;
  if (patch.type !== undefined) out.type = patch.type;
  if (patch.startDate !== undefined) out.start_date = patch.startDate;
  if (patch.endDate !== undefined) out.end_date = patch.endDate;
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.notes !== undefined) out.notes = patch.notes;
  return out;
}

function employeePatch(patch: Partial<Omit<Employee, "id">>) {
  const out: Database["public"]["Tables"]["employees"]["Update"] = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.email !== undefined) out.email = patch.email;
  if (patch.department !== undefined) out.department = patch.department;
  if (patch.position !== undefined) out.position = patch.position;
  if (patch.active !== undefined) out.active = patch.active;
  return out;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function describe(err: PostgrestError | Error | unknown): string {
  const e = err as Partial<PostgrestError> & { message?: string };
  switch (e.code) {
    case "23P01":
      return "That person already has a non-rejected leave overlapping these dates.";
    case "23505":
      return "Another team member already uses this email.";
    case "23503":
      return "This record is referenced by other data and can't be removed.";
    case "23514":
      return "The data was rejected by a validation rule (check the dates and fields).";
    case "PGRST205":
    case "42P01":
      return "The database tables don't exist yet. Run supabase/migrations/20261020000000_init_team_leave.sql in the Supabase SQL Editor, then reload.";
    case "42501":
      return "Permission denied by Supabase row level security. Check the policies in the migration.";
  }
  if (e.message?.includes("Failed to fetch")) return "Can't reach Supabase. Check your internet connection.";
  return e.message ?? "Unexpected error";
}

function check<T>(res: { data: T; error: PostgrestError | null }): T {
  if (res.error) throw res.error;
  return res.data;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const batch = check(await page(from, from + PAGE_SIZE - 1)) ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

async function fetchData(): Promise<AppData> {
  const sb = getSupabase();
  const [employees, leaves, settings] = await Promise.all([
    fetchAll<EmployeeRow>((a, b) => sb.from("employees").select("*").order("name").range(a, b)),
    fetchAll<LeaveRow>((a, b) => sb.from("leaves").select("*").order("start_date").range(a, b)),
    sb.from("app_settings").select("*").eq("id", 1).maybeSingle().then(check),
  ]);
  return {
    employees: employees.map(toEmployee),
    leaves: leaves.map(toLeave),
    settings: settings ? { weekendDays: settings.weekend_days } : DEFAULT_SETTINGS,
  };
}

let inflight: Promise<void> | null = null;

export function reload(): Promise<void> {
  if (inflight) return inflight;
  if (!state.data) setState({ status: "loading" });
  inflight = fetchData()
    .then((data) => setState({ status: "ready", data, error: null }))
    .catch((err) => {
      // Keep showing existing data on a failed background refresh.
      if (state.data) setState({ notice: describe(err) });
      else setState({ status: "error", error: describe(err) });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (state.status === "idle") reload();
  // Pick up changes made by teammates when coming back to the tab.
  const onVisible = () => document.visibilityState === "visible" && state.status === "ready" && reload();
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    listeners.delete(listener);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export function useStore(): StoreState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

/** Returns null while loading (and during server render), then the data from Supabase. */
export function useAppData(): AppData | null {
  return useStore().data;
}

// ---------------------------------------------------------------------------
// Mutations — applied optimistically, then persisted. On failure the error is
// shown and data is reloaded from the server so the UI never drifts.
// ---------------------------------------------------------------------------

function optimistic(fn: (d: AppData) => AppData, persist: () => PromiseLike<unknown>): Promise<boolean> {
  if (state.data) setState({ data: fn(state.data), notice: null });
  return Promise.resolve(persist())
    .then(() => true)
    .catch(async (err) => {
      setState({ notice: describe(err) });
      await reload();
      return false;
    });
}

const run = <T>(q: PromiseLike<{ data: T; error: PostgrestError | null }>) => Promise.resolve(q).then(check);

async function replaceAll(data: AppData) {
  const sb = getSupabase();
  check(await sb.from("leaves").delete().not("id", "is", null));
  check(await sb.from("employees").delete().not("id", "is", null));
  for (let i = 0; i < data.employees.length; i += PAGE_SIZE)
    check(await sb.from("employees").insert(data.employees.slice(i, i + PAGE_SIZE).map(fromEmployee), { defaultToNull: false }));
  for (let i = 0; i < data.leaves.length; i += PAGE_SIZE)
    check(await sb.from("leaves").insert(data.leaves.slice(i, i + PAGE_SIZE).map(fromLeave), { defaultToNull: false }));
  check(await sb.from("app_settings").upsert({ id: 1, weekend_days: data.settings.weekendDays }));
}

export const actions = {
  dismissNotice() {
    setState({ notice: null });
  },
  addEmployee(input: Omit<Employee, "id" | "createdAt" | "active">) {
    const employee: Employee = { ...input, id: crypto.randomUUID(), active: true, createdAt: new Date().toISOString() };
    return optimistic(
      (d) => ({ ...d, employees: [...d.employees, employee] }),
      () => run(getSupabase().from("employees").insert(fromEmployee(employee))),
    );
  },
  updateEmployee(id: string, patch: Partial<Omit<Employee, "id">>) {
    return optimistic(
      (d) => ({ ...d, employees: d.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)) }),
      () => run(getSupabase().from("employees").update(employeePatch(patch)).eq("id", id)),
    );
  },
  addLeave(input: Omit<Leave, "id" | "createdAt">) {
    const leave: Leave = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    return optimistic(
      (d) => ({ ...d, leaves: [...d.leaves, leave] }),
      () => run(getSupabase().from("leaves").insert(fromLeave(leave))),
    );
  },
  updateLeave(id: string, patch: Partial<Omit<Leave, "id">>) {
    return optimistic(
      (d) => ({ ...d, leaves: d.leaves.map((l) => (l.id === id ? { ...l, ...patch } : l)) }),
      () => run(getSupabase().from("leaves").update(leavePatch(patch)).eq("id", id)),
    );
  },
  deleteLeave(id: string) {
    return optimistic(
      (d) => ({ ...d, leaves: d.leaves.filter((l) => l.id !== id) }),
      () => run(getSupabase().from("leaves").delete().eq("id", id)),
    );
  },
  updateSettings(patch: Partial<Settings>) {
    return optimistic(
      (d) => ({ ...d, settings: { ...d.settings, ...patch } }),
      () =>
        run(
          getSupabase()
            .from("app_settings")
            .upsert({ id: 1, weekend_days: patch.weekendDays ?? state.data?.settings.weekendDays ?? DEFAULT_SETTINGS.weekendDays }),
        ),
    );
  },
  /** Replaces ALL employees and leaves in the database. Not atomic: on failure, data is reloaded. */
  importData(data: AppData) {
    const next = { ...data, settings: { ...DEFAULT_SETTINGS, ...data.settings } };
    return optimistic(() => next, () => replaceAll(next));
  },
  loadDemo() {
    return actions.importData(demoData());
  },
  clearAll() {
    return optimistic(
      (d) => ({ ...d, employees: [], leaves: [] }),
      async () => {
        const sb = getSupabase();
        check(await sb.from("leaves").delete().not("id", "is", null));
        check(await sb.from("employees").delete().not("id", "is", null));
      },
    );
  },
};

/** Data saved by the earlier localStorage-only version of the app in this browser, if any. */
export function readLegacyLocalData(): AppData | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AppData>;
    if (!Array.isArray(parsed.employees) || !Array.isArray(parsed.leaves)) return null;
    return {
      employees: parsed.employees,
      leaves: parsed.leaves,
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
    };
  } catch {
    return null;
  }
}

/** Sample team and leaves positioned around today so every screen has something to show. */
function demoData(): AppData {
  const now = new Date().toISOString();
  const people: [string, string, string][] = [
    ["Sara Hassan", "Engineering", "Frontend Engineer"],
    ["Omar Khaled", "Engineering", "Backend Engineer"],
    ["Mona Ali", "Engineering", "QA Engineer"],
    ["Youssef Ibrahim", "Product", "Product Manager"],
    ["Nour Mahmoud", "Design", "UX Designer"],
    ["Karim Mostafa", "Engineering", "DevOps Engineer"],
    ["Laila Samir", "Operations", "Team Coordinator"],
  ];
  const employees: Employee[] = people.map(([name, department, position], i) => ({
    id: crypto.randomUUID(),
    name,
    email: name.toLowerCase().replace(" ", ".") + "@example.com",
    department,
    position,
    active: i !== 6,
    createdAt: now,
  }));
  const week = startOfWeek(todayISO(), 0);
  const e = (i: number) => employees[i].id;
  const leave = (
    emp: number,
    start: number,
    len: number,
    type: Leave["type"],
    status: Leave["status"],
    notes = "",
  ): Leave => ({
    id: crypto.randomUUID(),
    employeeId: e(emp),
    type,
    startDate: addDays(week, start),
    endDate: addDays(week, start + len - 1),
    status,
    notes,
    createdAt: now,
  });
  const leaves: Leave[] = [
    leave(0, -30, 5, "Annual", "Approved", "Family trip"),
    leave(1, -21, 2, "Sick", "Approved", "Flu"),
    leave(3, -12, 1, "Emergency", "Approved"),
    leave(0, 1, 4, "Annual", "Approved", "Long weekend"),
    leave(2, 2, 2, "Sick", "Approved", "Doctor's note provided"),
    leave(4, 9, 5, "Annual", "Approved"),
    leave(1, 10, 3, "Annual", "Pending", "Wedding"),
    leave(5, 16, 3, "Annual", "Approved"),
    leave(3, 30, 7, "Annual", "Pending", "Summer holiday"),
    leave(2, 20, 1, "Emergency", "Rejected"),
    leave(6, -50, 10, "Annual", "Approved"),
  ];
  return { employees, leaves, settings: DEFAULT_SETTINGS };
}
