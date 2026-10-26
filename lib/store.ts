"use client";

import { useSyncExternalStore } from "react";
import type { PostgrestError, Session } from "@supabase/supabase-js";
import { getSupabase } from "./supabase/client";
import type { Database } from "./supabase/database.types";
import type { AppData, Employee, Holiday, Leave, LeaveType, Settings } from "./types";

type EmployeeRow = Database["public"]["Tables"]["employees"]["Row"];
type LeaveRow = Database["public"]["Tables"]["leaves"]["Row"];
type HolidayRow = Database["public"]["Tables"]["public_holidays"]["Row"];

export const ATTACHMENT_BUCKET = "leave-attachments";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];

const DEFAULT_SETTINGS: Settings = {
  weekendDays: [5, 6],
  deductingTypes: ["Annual"],
  hoursPerDay: 8,
  allowedSignupDomains: ["aman.eg"],
  generalManagerId: null,
  carryForwardEnabled: true,
  carryForwardFromYear: 2026,
};
const PAGE_SIZE = 1000;

export interface StoreState {
  /**
   * idle → loading → ready, or:
   * signed-out: no session; unlinked: signed in but no active employee record matches the email.
   */
  status: "idle" | "loading" | "signed-out" | "unlinked" | "ready" | "error";
  session: Session | null;
  data: AppData | null;
  /** Fatal load error (shown instead of the page). */
  error: string | null;
  /** Non-fatal error from the last save (shown as a banner). */
  notice: string | null;
}

let state: StoreState = { status: "idle", session: null, data: null, error: null, notice: null };
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
  role: r.role,
  annualAllowance: Number(r.annual_allowance),
  managerId: r.manager_id,
  userId: r.user_id,
  createdAt: r.created_at,
});

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

const toLeave = (r: LeaveRow): Leave => ({
  id: r.id,
  employeeId: r.employee_id,
  type: r.type,
  startDate: r.start_date,
  endDate: r.end_date,
  durationType: r.duration_type,
  startTime: hhmm(r.start_time),
  endTime: hhmm(r.end_time),
  hours: r.hours === null ? null : Number(r.hours),
  backupEmployeeId: r.backup_employee_id,
  attachmentPath: r.attachment_path,
  status: r.status,
  notes: r.notes,
  createdAt: r.created_at,
});

const toHoliday = (r: HolidayRow): Holiday => ({ id: r.id, name: r.name, startDate: r.start_date, endDate: r.end_date });

function leavePatch(patch: Partial<Omit<Leave, "id">>) {
  const out: Database["public"]["Tables"]["leaves"]["Update"] = {};
  if (patch.employeeId !== undefined) out.employee_id = patch.employeeId;
  if (patch.type !== undefined) out.type = patch.type;
  if (patch.startDate !== undefined) out.start_date = patch.startDate;
  if (patch.endDate !== undefined) out.end_date = patch.endDate;
  if (patch.durationType !== undefined) out.duration_type = patch.durationType;
  if (patch.startTime !== undefined) out.start_time = patch.startTime;
  if (patch.endTime !== undefined) out.end_time = patch.endTime;
  if (patch.hours !== undefined) out.hours = patch.hours;
  if (patch.backupEmployeeId !== undefined) out.backup_employee_id = patch.backupEmployeeId;
  if (patch.attachmentPath !== undefined) out.attachment_path = patch.attachmentPath;
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
  if (patch.role !== undefined) out.role = patch.role;
  if (patch.annualAllowance !== undefined) out.annual_allowance = patch.annualAllowance;
  if (patch.managerId !== undefined) out.manager_id = patch.managerId;
  return out;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export function describe(err: PostgrestError | Error | unknown): string {
  const e = err as Partial<PostgrestError> & { message?: string; statusCode?: string };
  switch (e.code) {
    case "23P01":
      return e.message?.startsWith("Overlaps")
        ? `${e.message}. Adjust the dates or reject the existing record first.`
        : "That person already has a leave overlapping these dates.";
    case "23505":
      return "Another team member already uses this email.";
    case "23503":
      return "This record is referenced by other data and can't be removed.";
    case "23514":
      return e.message?.includes("admin") ? e.message : "The data was rejected by a validation rule (check the dates and fields).";
    case "PGRST205":
    case "42P01":
    case "42703":
      return "The database is missing the latest tables or columns. Run the SQL files in supabase/migrations in the Supabase SQL Editor, then reload.";
    case "42501":
      return e.message && !e.message.startsWith("permission denied") && !e.message.startsWith("new row violates")
        ? e.message
        : "You don't have permission to do that.";
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

async function fetchData(userId: string): Promise<AppData | null> {
  const sb = getSupabase();
  const [employees, leaves, settings, holidays, directory] = await Promise.all([
    fetchAll<EmployeeRow>((a, b) => sb.from("employees").select("*").order("name").range(a, b)),
    fetchAll<LeaveRow>((a, b) => sb.from("leaves").select("*").order("start_date").range(a, b)),
    sb.from("app_settings").select("*").eq("id", 1).maybeSingle().then(check),
    sb.from("public_holidays").select("*").order("start_date").then(check),
    sb.rpc("employee_directory").then(check),
  ]);
  const me = employees.find((e) => e.user_id === userId && e.active);
  if (!me) return null;
  return {
    employees: employees.map(toEmployee),
    leaves: leaves.map(toLeave),
    holidays: (holidays ?? []).map(toHoliday),
    directory: directory ?? [],
    me: toEmployee(me),
    settings: settings
      ? {
          weekendDays: settings.weekend_days,
          deductingTypes: settings.deducting_types as LeaveType[],
          hoursPerDay: Number(settings.hours_per_day),
          allowedSignupDomains: settings.allowed_signup_domains ?? [],
          generalManagerId: settings.general_manager_id ?? null,
          carryForwardEnabled: settings.carry_forward_enabled ?? true,
          carryForwardFromYear: Number(settings.carry_forward_from_year ?? 2026),
        }
      : DEFAULT_SETTINGS,
  };
}

let inflight: Promise<void> | null = null;

export function reload(): Promise<void> {
  const session = state.session;
  if (!session) return Promise.resolve();
  if (inflight) return inflight;
  if (!state.data) setState({ status: "loading" });
  inflight = fetchData(session.user.id)
    .then((data) =>
      data ? setState({ status: "ready", data, error: null }) : setState({ status: "unlinked", data: null, error: null }),
    )
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

let authStarted = false;

function startAuth() {
  if (authStarted) return;
  authStarted = true;
  let sb: ReturnType<typeof getSupabase>;
  try {
    sb = getSupabase();
  } catch (err) {
    setState({ status: "error", error: describe(err) });
    return;
  }
  setState({ status: "loading" });
  sb.auth.onAuthStateChange((event, session) => {
    const userChanged = session?.user.id !== state.session?.user.id;
    if (!session) {
      setState({ status: "signed-out", session: null, data: null, notice: null });
      return;
    }
    setState({ session, ...(userChanged ? { data: null } : {}) });
    // Avoid calling Supabase inside the callback itself (can deadlock the auth lock).
    if (userChanged || event === "INITIAL_SESSION") setTimeout(reload, 0);
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  startAuth();
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

/** Returns null until signed in and loaded, then the data visible to the current user. */
export function useAppData(): AppData | null {
  return useStore().data;
}

// ---------------------------------------------------------------------------
// Email notifications (best effort: failures never block the save)
// ---------------------------------------------------------------------------

function notify(leaveId: string, event: "submitted" | "decided") {
  const token = state.session?.access_token;
  if (!token) return;
  fetch("/api/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ leaveId, event }),
  })
    .then(async (res) => {
      if (!res.ok) console.warn("Notification failed:", await res.text());
    })
    .catch((err) => console.warn("Notification failed:", err));
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

function attachmentPathFor(leaveId: string, file: File) {
  const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
  return `${leaveId}/${Date.now()}-${safe}`;
}

async function uploadAttachment(leaveId: string, file: File, previous: string | null): Promise<string> {
  const sb = getSupabase();
  const path = attachmentPathFor(leaveId, file);
  const up = await sb.storage.from(ATTACHMENT_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw new Error(`Attachment upload failed: ${up.error.message}`);
  check(await sb.from("leaves").update({ attachment_path: path }).eq("id", leaveId));
  if (previous) await sb.storage.from(ATTACHMENT_BUCKET).remove([previous]);
  return path;
}

export type NewLeave = Omit<Leave, "id" | "createdAt" | "attachmentPath">;
export type BackupConflict = Database["public"]["Functions"]["backup_conflict"]["Returns"] & {};

export const actions = {
  dismissNotice() {
    setState({ notice: null });
  },

  // ---- auth --------------------------------------------------------------
  async signIn(email: string, password: string): Promise<string | null> {
    const { error } = await getSupabase().auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  },
  async sendPasswordReset(email: string): Promise<string | null> {
    const { error } = await getSupabase().auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    return error ? error.message : null;
  },
  async signOut() {
    await getSupabase().auth.signOut();
  },

  // ---- employees (admin) -------------------------------------------------
  addEmployee(input: Pick<Employee, "name" | "email" | "department" | "position" | "role" | "annualAllowance" | "managerId">) {
    const employee: Employee = {
      ...input,
      id: crypto.randomUUID(),
      active: true,
      userId: null,
      createdAt: new Date().toISOString(),
    };
    return optimistic(
      (d) => ({ ...d, employees: [...d.employees, employee] }),
      async () => {
        check(
          await getSupabase().from("employees").insert({
            id: employee.id,
            name: employee.name,
            email: employee.email,
            department: employee.department,
            position: employee.position,
            role: employee.role,
            annual_allowance: employee.annualAllowance,
            manager_id: employee.managerId,
          }),
        );
        await reload(); // picks up an auto-linked account and the directory
      },
    );
  },
  updateEmployee(id: string, patch: Partial<Omit<Employee, "id">>) {
    return optimistic(
      (d) => ({ ...d, employees: d.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)) }),
      async () => {
        await run(getSupabase().from("employees").update(employeePatch(patch)).eq("id", id));
        if (patch.email !== undefined || patch.active !== undefined || patch.name !== undefined) await reload();
      },
    );
  },

  // ---- leaves ------------------------------------------------------------
  /** Creates a leave, uploads the optional attachment, then emails the team leads. */
  addLeave(input: NewLeave, file?: File | null) {
    const leave: Leave = { ...input, id: crypto.randomUUID(), attachmentPath: null, createdAt: new Date().toISOString() };
    return optimistic(
      (d) => ({ ...d, leaves: [...d.leaves, leave] }),
      async () => {
        check(
          await getSupabase()
            .from("leaves")
            .insert({ id: leave.id, created_at: leave.createdAt, ...leavePatch(input) } as Database["public"]["Tables"]["leaves"]["Insert"]),
        );
        if (file) {
          try {
            const path = await uploadAttachment(leave.id, file, null);
            if (state.data)
              setState({
                data: { ...state.data, leaves: state.data.leaves.map((l) => (l.id === leave.id ? { ...l, attachmentPath: path } : l)) },
              });
          } catch (err) {
            // The request itself was saved; report the attachment problem without rolling back.
            setState({ notice: `Leave saved, but ${describe(err).replace(/^Attachment/, "the attachment")}` });
          }
        }
        if (input.status === "Pending") notify(leave.id, "submitted");
      },
    );
  },
  updateLeave(id: string, patch: Partial<Omit<Leave, "id">>, file?: File | null) {
    const before = state.data?.leaves.find((l) => l.id === id);
    return optimistic(
      (d) => ({ ...d, leaves: d.leaves.map((l) => (l.id === id ? { ...l, ...patch } : l)) }),
      async () => {
        await run(getSupabase().from("leaves").update(leavePatch(patch)).eq("id", id));
        if (file) {
          const path = await uploadAttachment(id, file, before?.attachmentPath ?? null);
          if (state.data)
            setState({ data: { ...state.data, leaves: state.data.leaves.map((l) => (l.id === id ? { ...l, attachmentPath: path } : l)) } });
        }
        if (patch.status && patch.status !== before?.status && patch.status !== "Pending") notify(id, "decided");
      },
    );
  },
  deleteLeave(id: string) {
    const path = state.data?.leaves.find((l) => l.id === id)?.attachmentPath;
    return optimistic(
      (d) => ({ ...d, leaves: d.leaves.filter((l) => l.id !== id) }),
      async () => {
        await run(getSupabase().from("leaves").delete().eq("id", id));
        if (path) await getSupabase().storage.from(ATTACHMENT_BUCKET).remove([path]);
      },
    );
  },
  async removeAttachment(id: string) {
    const path = state.data?.leaves.find((l) => l.id === id)?.attachmentPath;
    if (!path) return true;
    return optimistic(
      (d) => ({ ...d, leaves: d.leaves.map((l) => (l.id === id ? { ...l, attachmentPath: null } : l)) }),
      async () => {
        await run(getSupabase().from("leaves").update({ attachment_path: null }).eq("id", id));
        await getSupabase().storage.from(ATTACHMENT_BUCKET).remove([path]);
      },
    );
  },
  /** Approved/pending leave of `backupId` overlapping [start, end], or null if they're free. */
  async backupConflict(backupId: string, start: string, end: string): Promise<BackupConflict | null> {
    const { data, error } = await getSupabase().rpc("backup_conflict", { p_backup: backupId, p_start: start, p_end: end });
    return error ? null : (data ?? null);
  },
  /** Short-lived signed URL for viewing a private attachment. */
  async attachmentUrl(path: string): Promise<string | null> {
    const { data, error } = await getSupabase().storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, 300);
    if (error) {
      setState({ notice: describe(error) });
      return null;
    }
    return data.signedUrl;
  },

  // ---- settings & holidays (admin) --------------------------------------
  updateSettings(patch: Partial<Settings>) {
    const next = { ...(state.data?.settings ?? DEFAULT_SETTINGS), ...patch };
    return optimistic(
      (d) => ({ ...d, settings: next }),
      () =>
        run(
          getSupabase()
            .from("app_settings")
            .update({
              weekend_days: next.weekendDays,
              deducting_types: next.deductingTypes,
              hours_per_day: next.hoursPerDay,
              allowed_signup_domains: next.allowedSignupDomains,
              general_manager_id: next.generalManagerId,
              carry_forward_enabled: next.carryForwardEnabled,
              carry_forward_from_year: next.carryForwardFromYear,
            })
            .eq("id", 1),
        ),
    );
  },
  addHoliday(input: Omit<Holiday, "id">) {
    const holiday: Holiday = { ...input, id: crypto.randomUUID() };
    return optimistic(
      (d) => ({ ...d, holidays: [...d.holidays, holiday].sort((a, b) => a.startDate.localeCompare(b.startDate)) }),
      () =>
        run(
          getSupabase()
            .from("public_holidays")
            .insert({ id: holiday.id, name: holiday.name, start_date: holiday.startDate, end_date: holiday.endDate }),
        ),
    );
  },
  updateHoliday(id: string, input: Omit<Holiday, "id">) {
    return optimistic(
      (d) => ({ ...d, holidays: d.holidays.map((h) => (h.id === id ? { id, ...input } : h)) }),
      () =>
        run(
          getSupabase()
            .from("public_holidays")
            .update({ name: input.name, start_date: input.startDate, end_date: input.endDate })
            .eq("id", id),
        ),
    );
  },
  deleteHoliday(id: string) {
    return optimistic(
      (d) => ({ ...d, holidays: d.holidays.filter((h) => h.id !== id) }),
      () => run(getSupabase().from("public_holidays").delete().eq("id", id)),
    );
  },
};

export const isAdmin = (data: AppData | null) => data?.me.role === "admin";
