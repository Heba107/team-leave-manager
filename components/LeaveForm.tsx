"use client";

import { useEffect, useState } from "react";
import { eachDay, formatDate, todayISO } from "@/lib/dates";
import {
  annualBalance,
  calendarDays,
  countLeaveDays,
  findSelfConflict,
  findTeamOverlaps,
  formatDays,
  holidayOn,
  hoursBetween,
  isWorkingDay,
  leaveDays,
} from "@/lib/leave";
import { actions, ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, type BackupConflict, type NewLeave } from "@/lib/store";
import type { AppData, DurationType, Leave, LeaveStatus, LeaveType } from "@/lib/types";
import { DURATION_LABELS, LEAVE_STATUSES, LEAVE_TYPES } from "@/lib/types";
import { Button, cx, Field, inputClass } from "./ui";

export type LeaveInput = NewLeave;

type HourMode = "times" | "total";

export function LeaveForm({
  data,
  initial,
  defaults,
  onSubmit,
  onCancel,
}: {
  data: AppData;
  initial?: Leave;
  defaults?: Partial<LeaveInput>;
  onSubmit: (input: LeaveInput, file: File | null) => void;
  onCancel: () => void;
}) {
  const admin = data.me.role === "admin";
  const today = todayISO();
  const [form, setForm] = useState<LeaveInput>({
    employeeId: initial?.employeeId ?? defaults?.employeeId ?? (admin ? "" : data.me.id),
    type: initial?.type ?? defaults?.type ?? "Annual",
    startDate: initial?.startDate ?? defaults?.startDate ?? today,
    endDate: initial?.endDate ?? defaults?.endDate ?? defaults?.startDate ?? today,
    durationType: initial?.durationType ?? "full",
    startTime: initial?.startTime ?? null,
    endTime: initial?.endTime ?? null,
    hours: initial?.hours ?? null,
    backupEmployeeId: initial?.backupEmployeeId ?? null,
    status: initial?.status ?? (admin ? (defaults?.status ?? "Pending") : "Pending"),
    notes: initial?.notes ?? "",
  });
  const [hourMode, setHourMode] = useState<HourMode>(initial?.durationType === "hourly" && !initial.startTime ? "total" : "times");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const set = (patch: Partial<LeaveInput>) => setForm((f) => ({ ...f, ...patch }));
  const partial = form.durationType !== "full";
  const hourly = form.durationType === "hourly";

  // Only active members can take new leave, but keep the current one selectable when editing.
  const employees = data.employees
    .filter((e) => e.active || e.id === initial?.employeeId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const employee = data.employees.find((e) => e.id === form.employeeId);
  const nameOf = (id: string) => data.directory.find((e) => e.id === id)?.name ?? data.employees.find((e) => e.id === id)?.name ?? "Unknown";
  const backups = data.directory.filter((e) => e.id !== form.employeeId);

  const hours = hourly ? (hourMode === "times" ? hoursBetween(form.startTime ?? "", form.endTime ?? "") : (form.hours ?? 0)) : null;
  const effective: LeaveInput = {
    ...form,
    endDate: partial ? form.startDate : form.endDate,
    hours,
    startTime: hourly && hourMode === "times" ? form.startTime : null,
    endTime: hourly && hourMode === "times" ? form.endTime : null,
  };
  const days = leaveDays(effective, data);
  const calDays = calendarDays(effective.startDate, effective.endDate);
  const workingDays = countLeaveDays(effective.startDate, effective.endDate, data);
  const skippedHolidays =
    effective.endDate >= effective.startDate && calDays <= 366
      ? [...new Set(eachDay(effective.startDate, effective.endDate).map((d) => holidayOn(d, data.holidays)?.name).filter(Boolean))]
      : [];
  const candidate: Leave = { ...effective, id: initial?.id ?? "__new__", createdAt: "", attachmentPath: initial?.attachmentPath ?? null };

  const errors: Partial<Record<"employeeId" | "startDate" | "endDate" | "hours" | "backup", string>> = {};
  if (!form.employeeId) errors.employeeId = "Select a team member";
  if (!form.startDate) errors.startDate = "Date is required";
  else if (partial && !isWorkingDay(form.startDate, data))
    errors.startDate = holidayOn(form.startDate, data.holidays)
      ? `${formatDate(form.startDate)} is a public holiday (${holidayOn(form.startDate, data.holidays)?.name})`
      : `${formatDate(form.startDate)} is a weekend day`;
  if (!partial) {
    if (!form.endDate) errors.endDate = "End date is required";
    else if (form.endDate < form.startDate) errors.endDate = "End date must be on or after the start date";
    else if (workingDays === 0) errors.endDate = "The selected range only contains weekends or public holidays";
  }
  if (hourly) {
    if (hourMode === "times" && (!form.startTime || !form.endTime)) errors.hours = "Enter a start and end time";
    else if (hourMode === "times" && (hours ?? 0) <= 0) errors.hours = "End time must be after start time";
    else if (!hours || hours <= 0) errors.hours = "Enter the number of hours";
    else if (hours > 12) errors.hours = "A permission can't exceed 12 hours — use a full or half day instead";
  }
  if (form.backupEmployeeId && form.backupEmployeeId === form.employeeId) errors.backup = "Choose someone else as backup";

  const checkable = !errors.endDate && !errors.startDate && form.employeeId && form.status !== "Rejected";
  const selfConflict = checkable ? findSelfConflict(candidate, data.leaves) : undefined;
  const teamOverlaps = checkable && !hourly ? findTeamOverlaps(candidate, data.leaves) : [];

  // The backup must not be on (approved or pending) leave during these dates. Employees can't see
  // colleagues' leave, so ask the database; it enforces the same rule when the request is saved.
  const backupUnchanged =
    !!initial &&
    initial.backupEmployeeId === form.backupEmployeeId &&
    initial.startDate === effective.startDate &&
    initial.endDate === effective.endDate;
  const backupKey =
    form.backupEmployeeId && checkable && !backupUnchanged
      ? `${form.backupEmployeeId}|${effective.startDate}|${effective.endDate}`
      : null;
  const [backupCheck, setBackupCheck] = useState<{ key: string; conflict: BackupConflict | null } | null>(null);
  useEffect(() => {
    if (!backupKey) return;
    let live = true;
    const [backup, start, end] = backupKey.split("|");
    actions.backupConflict(backup, start, end).then((conflict) => live && setBackupCheck({ key: backupKey, conflict }));
    return () => {
      live = false;
    };
  }, [backupKey]);
  const backupConflict = backupKey && backupCheck?.key === backupKey ? backupCheck.conflict : null;
  const backupError = backupConflict
    ? `${backupConflict.name} can't be your backup: they have ${backupConflict.status.toLowerCase()} leave from ${formatDate(backupConflict.start_date)} to ${formatDate(backupConflict.end_date)}. Choose someone else.`
    : undefined;

  // Balance preview for leave types that are deducted from the annual allowance.
  const year = Number(effective.startDate.slice(0, 4));
  // Balance on the request's own dates: a Q1 request can still use carried-over days,
  // and the request is charged to the year its dates fall in.
  const others = data.leaves.filter((l) => l.id !== initial?.id);
  const balance = employee && year ? annualBalance(employee, others, year, data, effective.startDate) : null;
  const deducts = data.settings.deductingTypes.includes(form.type) && !hourly;
  const afterThis =
    employee && balance
      ? annualBalance(employee, deducts ? [...others, { ...candidate, status: "Pending" }] : others, year, data, effective.startDate).available
      : 0;

  function pickFile(f: File | null) {
    setFileError("");
    if (!f) return setFile(null);
    if (f.size > MAX_ATTACHMENT_BYTES) return setFileError("File is larger than 10 MB");
    if (f.type && !ATTACHMENT_TYPES.includes(f.type)) return setFileError("Use a PDF, JPG, PNG, WEBP or HEIC file");
    setFile(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length || selfConflict || fileError || backupError) return;
    if (backupKey && backupCheck?.key !== backupKey) {
      // The availability check hasn't come back yet: wait for it before submitting.
      const [backup, start, end] = backupKey.split("|");
      const conflict = await actions.backupConflict(backup, start, end);
      setBackupCheck({ key: backupKey, conflict });
      if (conflict) return;
    }
    onSubmit({ ...effective, notes: form.notes.trim() }, form.type === "Sick" ? file : null);
  }

  const show = (k: keyof typeof errors) => (submitted ? errors[k] : undefined);

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {admin ? (
        <Field label="Team member *" error={show("employeeId")}>
          <select className={inputClass} value={form.employeeId} onChange={(e) => set({ employeeId: e.target.value })}>
            <option value="">Select…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {!e.active ? " (inactive)" : ""}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <p className="text-sm text-zinc-500">
          Request for <strong className="text-zinc-900">{data.me.name}</strong>. Your team lead will be notified by email.
        </p>
      )}

      <div className={cx("grid grid-cols-1 gap-4", admin && "sm:grid-cols-2")}>
        <Field label="Leave type *">
          <select className={inputClass} value={form.type} onChange={(e) => set({ type: e.target.value as LeaveType })}>
            {LEAVE_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        {admin && (
          <Field label="Status *">
            <select className={inputClass} value={form.status} onChange={(e) => set({ status: e.target.value as LeaveStatus })}>
              {LEAVE_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <Field label="Duration *">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 text-sm sm:grid-cols-4">
          {(Object.keys(DURATION_LABELS) as DurationType[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => set({ durationType: d })}
              className={cx(
                "rounded-md px-2 py-1.5 text-xs font-medium",
                form.durationType === d ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800",
              )}
            >
              {d === "full" ? "Full day(s)" : d === "half_am" ? "½ Morning" : d === "half_pm" ? "½ Afternoon" : "Hourly (Ozon)"}
            </button>
          ))}
        </div>
      </Field>

      {partial ? (
        <Field label="Date *" error={show("startDate")}>
          <input type="date" className={inputClass} value={form.startDate} onChange={(e) => set({ startDate: e.target.value, endDate: e.target.value })} />
        </Field>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Start date *" error={show("startDate")}>
            <input
              type="date"
              className={inputClass}
              value={form.startDate}
              onChange={(e) => {
                const startDate = e.target.value;
                // Keep the range valid when moving the start date past the end date.
                setForm((f) => ({ ...f, startDate, endDate: f.endDate < startDate ? startDate : f.endDate }));
              }}
            />
          </Field>
          <Field label="End date *" error={show("endDate")}>
            <input type="date" className={inputClass} value={form.endDate} min={form.startDate} onChange={(e) => set({ endDate: e.target.value })} />
          </Field>
        </div>
      )}

      {hourly && (
        <div className="space-y-2">
          <div className="flex gap-4 text-sm">
            {(["times", "total"] as const).map((m) => (
              <label key={m} className="flex items-center gap-1.5 text-zinc-700">
                <input type="radio" checked={hourMode === m} onChange={() => setHourMode(m)} className="accent-indigo-600" />
                {m === "times" ? "Start / end time" : "Total hours"}
              </label>
            ))}
          </div>
          {hourMode === "times" ? (
            <div className="grid grid-cols-2 gap-4">
              <Field label="From">
                <input type="time" className={inputClass} value={form.startTime ?? ""} onChange={(e) => set({ startTime: e.target.value || null })} />
              </Field>
              <Field label="To">
                <input type="time" className={inputClass} value={form.endTime ?? ""} onChange={(e) => set({ endTime: e.target.value || null })} />
              </Field>
            </div>
          ) : (
            <Field label="Hours">
              <input
                type="number"
                min={0.25}
                max={12}
                step={0.25}
                className={inputClass}
                value={form.hours ?? ""}
                onChange={(e) => set({ hours: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </Field>
          )}
          {show("hours") && <p className="text-xs text-rose-600">{errors.hours}</p>}
        </div>
      )}

      <div className="space-y-1 rounded-lg bg-zinc-50 px-4 py-3 text-sm ring-1 ring-inset ring-zinc-200">
        <p>
          <span className="text-zinc-500">Duration: </span>
          {hourly ? (
            <span className="font-semibold text-zinc-900">
              {hours ? `${hours} hour${hours === 1 ? "" : "s"}` : "—"} <span className="font-normal text-zinc-500">(permission, no days deducted)</span>
            </span>
          ) : (
            <span className="font-semibold text-zinc-900">
              {formatDays(days)} leave day{days === 1 ? "" : "s"}
            </span>
          )}
          {!partial && calDays > 0 && (
            <span className="text-zinc-500">
              {" "}
              ({calDays} calendar day{calDays === 1 ? "" : "s"}; weekends and public holidays excluded)
            </span>
          )}
        </p>
        {!partial && skippedHolidays.length > 0 && <p className="text-xs text-zinc-500">Public holidays skipped: {skippedHolidays.join(", ")}</p>}
        {balance && deducts && (
          <p className={cx("text-xs", afterThis < 0 ? "font-medium text-rose-700" : "text-zinc-500")}>
            {employee?.id === data.me.id ? "Your" : `${employee?.name}'s`} {year} annual balance: {formatDays(balance.remaining)} days left
            {balance.carriedAvailable > 0 &&
              ` (incl. ${formatDays(balance.carriedAvailable)} carried from ${year - 1}, used first, valid until ${formatDate(balance.carryExpiresOn)})`}
            {balance.pending > 0 && `, ${formatDays(balance.pending)} pending`} → {formatDays(afterThis)} after this request
            {afterThis < 0 && " (exceeds the allowance)"}
          </p>
        )}
      </div>

      {selfConflict && (
        <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-inset ring-rose-200">
          {admin ? nameOf(form.employeeId) : "You"} already {admin ? "has" : "have"} a {selfConflict.status.toLowerCase()}{" "}
          {selfConflict.type.toLowerCase()} leave from {formatDate(selfConflict.startDate)} to {formatDate(selfConflict.endDate)}.
          Adjust the dates{admin ? " or reject the existing record first" : ""}.
        </div>
      )}

      {teamOverlaps.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          <p className="font-medium">⚠ Overlaps with {teamOverlaps.length} other leave{teamOverlaps.length > 1 ? "s" : ""}:</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {teamOverlaps.map((l) => (
              <li key={l.id}>
                {nameOf(l.employeeId)} — {formatDate(l.startDate)} → {formatDate(l.endDate)} ({l.status})
              </li>
            ))}
          </ul>
        </div>
      )}

      <Field label="Backup / handover person" error={show("backup") ?? backupError}>
        <select
          className={inputClass}
          value={form.backupEmployeeId ?? ""}
          onChange={(e) => set({ backupEmployeeId: e.target.value || null })}
        >
          <option value="">None</option>
          {backups.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
              {e.department ? ` · ${e.department}` : ""}
            </option>
          ))}
        </select>
      </Field>

      {form.type === "Sick" && (
        <Field label="Medical certificate (optional)" error={fileError}>
          {initial?.attachmentPath && !file && <ExistingAttachment leave={initial} />}
          <input
            type="file"
            accept={ATTACHMENT_TYPES.join(",")}
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-700 hover:file:bg-zinc-200"
          />
          <span className="mt-1 block text-xs text-zinc-500">PDF or image, up to 10 MB. Only you and team leads can see it.</span>
        </Field>
      )}

      <Field label="Notes">
        <textarea
          className={inputClass}
          rows={3}
          value={form.notes}
          onChange={(e) => set({ notes: e.target.value })}
          placeholder="Optional reason or handover details"
        />
      </Field>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{initial ? "Save changes" : admin ? "Create leave" : "Submit request"}</Button>
      </div>
    </form>
  );
}

function ExistingAttachment({ leave }: { leave: Leave }) {
  return (
    <div className="mb-2 flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm ring-1 ring-inset ring-zinc-200">
      <AttachmentLink path={leave.attachmentPath!} />
      <button type="button" className="text-xs font-medium text-rose-600 hover:underline" onClick={() => actions.removeAttachment(leave.id)}>
        Remove
      </button>
    </div>
  );
}

/** Opens a private attachment through a short-lived signed URL. */
export function AttachmentLink({ path, compact }: { path: string; compact?: boolean }) {
  const name = path.split("/").pop()?.replace(/^\d+-/, "") ?? "attachment";
  return (
    <button
      type="button"
      title={name}
      onClick={async () => {
        // Open the tab synchronously so popup blockers allow it, then point it at the signed URL.
        const tab = window.open("", "_blank");
        const url = await actions.attachmentUrl(path);
        if (url && tab) tab.location.href = url;
        else tab?.close();
      }}
      className="inline-flex max-w-full items-center gap-1 truncate text-indigo-600 hover:underline"
    >
      📎 {compact ? "Certificate" : name}
    </button>
  );
}
