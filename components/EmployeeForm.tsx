"use client";

import { useState } from "react";
import type { Employee } from "@/lib/types";
import { Button, Field, inputClass } from "./ui";

export type EmployeeInput = Pick<Employee, "name" | "email" | "department" | "position">;

export function EmployeeForm({
  initial,
  existing,
  onSubmit,
  onCancel,
}: {
  initial?: Employee;
  existing: Employee[];
  onSubmit: (input: EmployeeInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<EmployeeInput>({
    name: initial?.name ?? "",
    email: initial?.email ?? "",
    department: initial?.department ?? "",
    position: initial?.position ?? "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof EmployeeInput, string>>>({});
  const departments = [...new Set(existing.map((e) => e.department).filter(Boolean))].sort();

  const set = (k: keyof EmployeeInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    if (!name) next.name = "Name is required";
    if (email && !/^\S+@\S+\.\S+$/.test(email)) next.email = "Enter a valid email";
    if (email && existing.some((x) => x.id !== initial?.id && x.email.toLowerCase() === email))
      next.email = "Another team member already uses this email";
    setErrors(next);
    if (Object.keys(next).length) return;
    onSubmit({ name, email, department: form.department.trim(), position: form.position.trim() });
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Full name *" error={errors.name}>
        <input className={inputClass} value={form.name} onChange={set("name")} autoFocus />
      </Field>
      <Field label="Email" error={errors.email}>
        <input className={inputClass} type="email" value={form.email} onChange={set("email")} />
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
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{initial ? "Save changes" : "Add member"}</Button>
      </div>
    </form>
  );
}
