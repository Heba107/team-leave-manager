"use client";

import { useState } from "react";
import type { Employee, Role } from "@/lib/types";
import { Button, Field, inputClass } from "./ui";

export type EmployeeInput = Pick<Employee, "name" | "email" | "department" | "position" | "role" | "annualAllowance" | "managerId">;

export function EmployeeForm({
  initial,
  existing,
  isSelf,
  onSubmit,
  onCancel,
}: {
  initial?: Employee;
  existing: Employee[];
  /** Editing your own record: role can't be changed (prevents locking yourself out). */
  isSelf?: boolean;
  onSubmit: (input: EmployeeInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    email: initial?.email ?? "",
    department: initial?.department ?? "",
    position: initial?.position ?? "",
    role: initial?.role ?? ("employee" as Role),
    annualAllowance: String(initial?.annualAllowance ?? 21),
    managerId: initial?.managerId ?? "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const departments = [...new Set(existing.map((e) => e.department).filter(Boolean))].sort();
  // Anyone active except this person; admins (team leads) first.
  const managers = existing
    .filter((e) => e.active && e.id !== initial?.id)
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "admin" ? -1 : 1));

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    const allowance = Number(form.annualAllowance);
    if (!name) next.name = "Name is required";
    if (!email) next.email = "Email is required — it's how this person signs in";
    else if (!/^\S+@\S+\.\S+$/.test(email)) next.email = "Enter a valid email";
    else if (existing.some((x) => x.id !== initial?.id && x.email.toLowerCase() === email))
      next.email = "Another team member already uses this email";
    if (form.annualAllowance === "" || !Number.isFinite(allowance) || allowance < 0 || allowance > 365)
      next.annualAllowance = "Enter a number of days between 0 and 365";
    else if (allowance * 2 !== Math.round(allowance * 2)) next.annualAllowance = "Use whole or half days";
    setErrors(next);
    if (Object.keys(next).length) return;
    onSubmit({
      name,
      email,
      department: form.department.trim(),
      position: form.position.trim(),
      role: form.role,
      annualAllowance: allowance,
      managerId: form.managerId || null,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Full name *" error={errors.name}>
        <input className={inputClass} value={form.name} onChange={set("name")} autoFocus />
      </Field>
      <Field label="Work email *" error={errors.email}>
        <input className={inputClass} type="email" value={form.email} onChange={set("email")} />
        <span className="mt-1 block text-xs text-zinc-500">
          {initial?.userId ? "✓ Linked to a sign-in account." : "They sign up with this email to get access; it links automatically."}
        </span>
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Department">
          <input className={inputClass} value={form.department} onChange={set("department")} list="departments" />
          <datalist id="departments">
            {departments.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </Field>
        <Field label="Position">
          <input className={inputClass} value={form.position} onChange={set("position")} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Annual leave allowance (days) *" error={errors.annualAllowance}>
          <input className={inputClass} type="number" min={0} max={365} step={0.5} value={form.annualAllowance} onChange={set("annualAllowance")} />
        </Field>
        <Field label="Role">
          <select className={inputClass} value={form.role} onChange={set("role")} disabled={isSelf}>
            <option value="employee">Employee</option>
            <option value="admin">Admin (team lead)</option>
          </select>
          {isSelf && <span className="mt-1 block text-xs text-zinc-500">You can&apos;t change your own role.</span>}
        </Field>
      </div>
      <Field label="Direct manager">
        <select className={inputClass} value={form.managerId} onChange={set("managerId")}>
          <option value="">None</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.role === "admin" ? " (team lead)" : ""}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-zinc-500">
          Gets an email when this person requests leave, together with the General Manager. Team leads&apos; requests go to the General
          Manager only. All admins still see every request.
        </span>
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{initial ? "Save changes" : "Add member"}</Button>
      </div>
    </form>
  );
}
