"use client";

import { useState } from "react";
import { formatDate, todayISO } from "@/lib/dates";
import { calendarDays, countLeaveDays, findSelfConflict, findTeamOverlaps } from "@/lib/leave";
import type { AppData, Leave, LeaveStatus, LeaveType } from "@/lib/types";
import { LEAVE_STATUSES, LEAVE_TYPES } from "@/lib/types";
import { Button, Field, inputClass } from "./ui";

export type LeaveInput = Omit<Leave, "id" | "createdAt">;

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
  onSubmit: (input: LeaveInput) => void;
  onCancel: () => void;
}) {
  const today = todayISO();
  const [form, setForm] = useState<LeaveInput>({
    employeeId: initial?.employeeId ?? defaults?.employeeId ?? "",
    type: initial?.type ?? defaults?.type ?? "Annual",
    startDate: initial?.startDate ?? defaults?.startDate ?? today,
    endDate: initial?.endDate ?? defaults?.endDate ?? defaults?.startDate ?? today,
    status: initial?.status ?? defaults?.status ?? "Pending",
    notes: initial?.notes ?? "",
  });
  const [submitted, setSubmitted] = useState(false);

  // Only active members can take new leave, but keep the current one selectable when editing.
  const employees = data.employees
    .filter((e) => e.active || e.id === initial?.employeeId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const nameOf = (id: string) => data.employees.find((e) => e.id === id)?.name ?? "Unknown";

  const days = countLeaveDays(form.startDate, form.endDate, data.settings);
  const calDays = calendarDays(form.startDate, form.endDate);
  const candidate: Leave = { ...form, id: initial?.id ?? "__new__", createdAt: "" };

  const errors: Partial<Record<keyof LeaveInput, string>> = {};
  if (!form.employeeId) errors.employeeId = "Select a team member";
  if (!form.startDate) errors.startDate = "Start date is required";
  if (!form.endDate) errors.endDate = "End date is required";
  else if (form.endDate < form.startDate) errors.endDate = "End date must be on or after the start date";
  else if (days === 0) errors.endDate = "The selected range only contains weekend days";

  const selfConflict =
    form.employeeId && !errors.endDate && form.status !== "Rejected" ? findSelfConflict(candidate, data.leaves) : undefined;
  const teamOverlaps =
    !errors.endDate && form.status !== "Rejected" && form.employeeId ? findTeamOverlaps(candidate, data.leaves) : [];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length || selfConflict) return;
    onSubmit({ ...form, notes: form.notes.trim() });
  }

  const show = (k: keyof LeaveInput) => (submitted ? errors[k] : undefined);

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Team member *" error={show("employeeId")}>
        <select
          className={inputClass}
          value={form.employeeId}
          onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
        >
          <option value="">Select…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
              {!e.active ? " (inactive)" : ""}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Leave type *">
          <select
            className={inputClass}
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as LeaveType })}
          >
            {LEAVE_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Status *">
          <select
            className={inputClass}
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as LeaveStatus })}
          >
            {LEAVE_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>

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
          <input
            type="date"
            className={inputClass}
            value={form.endDate}
            min={form.startDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
          />
        </Field>
      </div>

      <div className="rounded-lg bg-zinc-50 px-4 py-3 text-sm ring-1 ring-inset ring-zinc-200">
        <span className="text-zinc-500">Duration: </span>
        <span className="font-semibold text-zinc-900">
          {days} leave day{days === 1 ? "" : "s"}
        </span>
        {calDays !== days && calDays > 0 && (
          <span className="text-zinc-500"> ({calDays} calendar days, weekends excluded)</span>
        )}
      </div>

      {selfConflict && (
        <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-inset ring-rose-200">
          {nameOf(form.employeeId)} already has a {selfConflict.status.toLowerCase()} {selfConflict.type.toLowerCase()}{" "}
          leave from {formatDate(selfConflict.startDate)} to {formatDate(selfConflict.endDate)}. Adjust the dates or
          reject the existing record first.
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

      <Field label="Notes">
        <textarea
          className={inputClass}
          rows={3}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Optional reason or handover details"
        />
      </Field>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{initial ? "Save changes" : "Create leave"}</Button>
      </div>
    </form>
  );
}
