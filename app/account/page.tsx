"use client";

import { useState } from "react";
import { Button, Card, Field, inputClass, Loading, PageHeader, toast } from "@/components/ui";
import { actions, useAppData } from "@/lib/store";
import type { AppData } from "@/lib/types";

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72; // bcrypt limit used by Supabase Auth

/** My Account: profile details and password change, open to every role. */
export default function AccountPage() {
  const data = useAppData();
  if (!data) return <Loading />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="My Account" description="Your profile details and password." />
      <div className="space-y-6">
        <ProfileCard data={data} />
        <PasswordCard />
      </div>
    </div>
  );
}

function roleLabel(data: AppData) {
  const { me, settings } = data;
  if (settings.generalManagerId === me.id) return "General Manager (admin)";
  return me.role === "admin" ? "Admin · Team lead" : "Employee";
}

function ProfileCard({ data }: { data: AppData }) {
  const { me, squads, directory } = data;
  const [name, setName] = useState(me.name);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const clean = name.trim().replace(/\s+/g, " ");
  const nameError = clean.length < 2 ? "Enter your full name (at least 2 characters)." : clean.length > 100 ? "Keep it under 100 characters." : "";
  const changed = clean !== me.name;
  const squad = squads.find((s) => s.id === me.squadId);
  const manager = me.managerId ? directory.find((d) => d.id === me.managerId)?.name : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (nameError || !changed) return;
    setSaving(true);
    const error = await actions.updateMyName(clean);
    setSaving(false);
    if (error) return toast.error(`Name not saved: ${error}`);
    setName(clean);
    setTouched(false);
    toast.success("Your name has been updated.");
  }

  const details: [string, string][] = [
    ["Email", me.email],
    ["Role", roleLabel(data)],
    ["Squad", squad?.name ?? "Not in a squad"],
    ["Department", me.department || "—"],
    ["Position", me.position || "—"],
    ["Direct manager", manager ?? "Not assigned"],
  ];

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-zinc-900">Profile</h2>
      <form onSubmit={save} noValidate className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1">
          <Field label="Full name" error={touched ? nameError : ""}>
            <input
              className={inputClass}
              value={name}
              maxLength={120}
              autoComplete="name"
              aria-invalid={touched && !!nameError}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
            />
          </Field>
        </div>
        <Button type="submit" className="sm:mt-6" disabled={saving || !changed || (touched && !!nameError)}>
          {saving ? "Saving…" : "Save name"}
        </Button>
      </form>
      <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-4 border-t border-zinc-100 pt-5 text-sm sm:grid-cols-2">
        {details.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-zinc-500">{label}</dt>
            <dd className="mt-0.5 truncate font-medium text-zinc-900" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 text-xs text-zinc-500">Email, role, squad and manager are managed by your team lead.</p>
    </Card>
  );
}

function passwordProblems(current: string, next: string, confirm: string) {
  return {
    current: current ? "" : "Enter your current password.",
    next:
      next.length < MIN_PASSWORD
        ? `Use at least ${MIN_PASSWORD} characters.`
        : next.length > MAX_PASSWORD
          ? `Use at most ${MAX_PASSWORD} characters.`
          : next === current
            ? "Choose a password that's different from your current one."
            : "",
    confirm: confirm === next ? "" : "The passwords don't match.",
  };
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState({ current: false, next: false, confirm: false });
  const [saving, setSaving] = useState(false);

  const problems = passwordProblems(current, next, confirm);
  const show = (k: keyof typeof touched) => (touched[k] ? problems[k] : "");
  const touch = (k: keyof typeof touched) => () => setTouched((t) => ({ ...t, [k]: true }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ current: true, next: true, confirm: true });
    if (problems.current || problems.next || problems.confirm) return;
    setSaving(true);
    const error = await actions.changePassword(current, next);
    setSaving(false);
    if (error) return toast.error(`Password not changed: ${error}`);
    setCurrent("");
    setNext("");
    setConfirm("");
    setTouched({ current: false, next: false, confirm: false });
    toast.success("Your password has been changed.");
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-zinc-900">Change password</h2>
      <p className="mt-1 text-sm text-zinc-500">
        {MIN_PASSWORD}–{MAX_PASSWORD} characters. You&apos;ll stay signed in on this device.
      </p>
      <form onSubmit={save} noValidate className="mt-4 max-w-sm space-y-4">
        <Field label="Current password" error={show("current")}>
          <input
            className={inputClass}
            type="password"
            autoComplete="current-password"
            value={current}
            aria-invalid={!!show("current")}
            onChange={(e) => setCurrent(e.target.value)}
            onBlur={touch("current")}
          />
        </Field>
        <Field label="New password" error={show("next")}>
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            value={next}
            aria-invalid={!!show("next")}
            onChange={(e) => setNext(e.target.value)}
            onBlur={touch("next")}
          />
        </Field>
        <Field label="Repeat new password" error={show("confirm")}>
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            value={confirm}
            aria-invalid={!!show("confirm")}
            onChange={(e) => setConfirm(e.target.value)}
            onBlur={touch("confirm")}
          />
        </Field>
        <Button type="submit" disabled={saving}>
          {saving ? "Changing…" : "Change password"}
        </Button>
      </form>
    </Card>
  );
}
