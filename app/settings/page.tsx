"use client";

import { useState } from "react";
import { Button, Card, cx, EmptyState, Field, inputClass, Loading, Modal, PageHeader } from "@/components/ui";
import { formatDate, todayISO, WEEKDAY_NAMES } from "@/lib/dates";
import { calendarDays } from "@/lib/leave";
import { actions, reload, useAppData } from "@/lib/store";
import type { Holiday, LeaveType } from "@/lib/types";
import { LEAVE_TYPES } from "@/lib/types";

/**
 * Egypt's fixed-date official holidays. Islamic holidays (Eid al-Fitr, Eid al-Adha,
 * Islamic New Year, Prophet's Birthday) follow the lunar calendar and must be added
 * each year once the dates are announced.
 */
const EGYPT_FIXED: [string, string][] = [
  ["01-07", "Coptic Christmas"],
  ["01-25", "January 25 Revolution & Police Day"],
  ["04-25", "Sinai Liberation Day"],
  ["05-01", "Labour Day"],
  ["06-30", "June 30 Revolution"],
  ["07-23", "July 23 Revolution Day"],
  ["10-06", "Armed Forces Day (6th of October)"],
];

export default function SettingsPage() {
  const data = useAppData();
  const [editing, setEditing] = useState<Holiday | "new" | null>(null);
  const [deleting, setDeleting] = useState<Holiday | null>(null);
  const [yearFilter, setYearFilter] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  if (!data) return <Loading />;
  const { settings, holidays } = data;
  const thisYear = Number(todayISO().slice(0, 4));
  const year = yearFilter ?? thisYear;
  const yearHolidays = holidays.filter((h) => h.startDate.startsWith(String(year)) || h.endDate.startsWith(String(year)));

  function toggleDay(day: number) {
    const next = settings.weekendDays.includes(day) ? settings.weekendDays.filter((d) => d !== day) : [...settings.weekendDays, day].sort();
    actions.updateSettings({ weekendDays: next });
  }

  function toggleDeducting(type: LeaveType) {
    const next = settings.deductingTypes.includes(type)
      ? settings.deductingTypes.filter((t) => t !== type)
      : LEAVE_TYPES.filter((t) => t === type || settings.deductingTypes.includes(t));
    actions.updateSettings({ deductingTypes: next });
  }

  async function addEgyptFixed() {
    const missing = EGYPT_FIXED.map(([md, name]) => ({ date: `${year}-${md}`, name })).filter(
      ({ date }) => !holidays.some((h) => h.startDate <= date && h.endDate >= date),
    );
    for (const m of missing) await actions.addHoliday({ name: m.name, startDate: m.date, endDate: m.date });
    setMessage(missing.length ? `Added ${missing.length} holidays for ${year}.` : `All fixed-date holidays for ${year} are already listed.`);
  }

  function backup() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `team-leave-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title="Settings" description="Leave rules shared by the whole team. Only admins can change them." />

      <Card className="mb-6 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-semibold">Public holidays</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Holidays are skipped when counting leave days, like weekends. Add multi-day holidays such as Eid as one range.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setYearFilter(year - 1)} aria-label="Previous year">
              ←
            </Button>
            <span className="w-12 text-center text-sm font-medium">{year}</span>
            <Button size="sm" variant="secondary" onClick={() => setYearFilter(year + 1)} aria-label="Next year">
              →
            </Button>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg ring-1 ring-zinc-200">
          {yearHolidays.length === 0 ? (
            <EmptyState>No public holidays for {year} yet.</EmptyState>
          ) : (
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-zinc-100">
                {yearHolidays.map((h) => {
                  const len = calendarDays(h.startDate, h.endDate);
                  return (
                    <tr key={h.id} className="hover:bg-zinc-50">
                      <td className="px-4 py-2.5 font-medium text-zinc-900">{h.name}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-zinc-600">
                        {formatDate(h.startDate)}
                        {h.endDate !== h.startDate && ` → ${formatDate(h.endDate)}`}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-500">{len === 1 ? "1 day" : `${len} days`}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(h)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setDeleting(h)}>
                          Delete
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setEditing("new")}>
            + Add holiday
          </Button>
          <Button size="sm" variant="secondary" onClick={addEgyptFixed}>
            Add Egypt&apos;s fixed-date holidays for {year}
          </Button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Eid al-Fitr, Eid al-Adha, Islamic New Year and the Prophet&apos;s Birthday move every year — add them once the official dates are
          announced. If the government moves a holiday (e.g. to a Thursday), edit its date here.
        </p>
        {message && <p className="mt-2 text-sm text-zinc-600">{message}</p>}
      </Card>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold">Weekend days</h2>
          <p className="mt-1 text-sm text-zinc-500">Skipped when counting leave days. A Sunday–Thursday week uses Friday + Saturday.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {WEEKDAY_NAMES.map((name, i) => (
              <button
                key={name}
                onClick={() => toggleDay(i)}
                className={cx(
                  "rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset",
                  settings.weekendDays.includes(i) ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-zinc-700 ring-zinc-300 hover:bg-zinc-50",
                )}
              >
                {name}
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold">Annual balance rules</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Leave types deducted from each employee&apos;s annual allowance (set per employee on the Employees page). Hourly permissions never
            deduct days.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {LEAVE_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => toggleDeducting(t)}
                className={cx(
                  "rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset",
                  settings.deductingTypes.includes(t) ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-zinc-700 ring-zinc-300 hover:bg-zinc-50",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="mt-4 max-w-48">
            <Field label="Working hours per day">
              <input
                type="number"
                min={1}
                max={24}
                step={0.5}
                className={inputClass}
                defaultValue={settings.hoursPerDay}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (v >= 1 && v <= 24 && v !== settings.hoursPerDay) actions.updateSettings({ hoursPerDay: v });
                }}
              />
            </Field>
            <p className="mt-1 text-xs text-zinc-500">Used to show permission hours as day-equivalents in reports.</p>
          </div>
          <div className="mt-5 border-t border-zinc-100 pt-4">
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-800">
              <input
                type="checkbox"
                className="accent-indigo-600"
                checked={settings.carryForwardEnabled}
                onChange={(e) => actions.updateSettings({ carryForwardEnabled: e.target.checked })}
              />
              Carry unused days into the next year&apos;s first quarter
            </label>
            <p className="mt-1 text-xs text-zinc-500">
              On 1 January each person&apos;s unused allowance from the previous year is added to their balance. Leave dated up to 31 March
              uses those days first; whatever is left expires on 1 April.
            </p>
            {settings.carryForwardEnabled && (
              <div className="mt-3 max-w-48">
                <Field label="Carry over starting from year">
                  <input
                    type="number"
                    min={2000}
                    max={2100}
                    className={inputClass}
                    defaultValue={settings.carryForwardFromYear}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isInteger(v) && v >= 2000 && v <= 2100 && v !== settings.carryForwardFromYear)
                        actions.updateSettings({ carryForwardFromYear: v });
                    }}
                  />
                </Field>
                <p className="mt-1 text-xs text-zinc-500">
                  Unused {settings.carryForwardFromYear} days are available until 31 Mar {settings.carryForwardFromYear + 1}. Earlier years
                  don&apos;t carry over.
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card className="mb-6 p-5">
        <h2 className="font-semibold">Leave request emails</h2>
        <p className="mt-1 text-sm text-zinc-500">
          A new request from an employee emails their direct manager (set on the Employees page) and the General Manager. A team
          lead&apos;s own request emails the General Manager only. If neither is set, all other admins are emailed. Every admin can still
          see and manage all requests.
        </p>
        <div className="mt-4 max-w-md">
          <Field label="General Manager">
            <select
              className={inputClass}
              value={settings.generalManagerId ?? ""}
              onChange={(e) => actions.updateSettings({ generalManagerId: e.target.value || null })}
            >
              <option value="">Not set</option>
              {data.employees
                .filter((e) => e.active)
                .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "admin" ? -1 : 1))
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {e.email ? ` · ${e.email}` : " · no email"}
                  </option>
                ))}
            </select>
          </Field>
        </div>
      </Card>

      <Card className="mb-6 p-5">
        <h2 className="font-semibold">Who can sign up</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Email domains allowed to create an account, separated by commas. New accounts start as Employees. Leave empty to allow any
          email address.
        </p>
        <div className="mt-4 max-w-md">
          <input
            className={inputClass}
            defaultValue={settings.allowedSignupDomains.join(", ")}
            placeholder="aman.eg"
            onBlur={(e) => {
              const next = [
                ...new Set(
                  e.target.value
                    .split(/[,\s]+/)
                    .map((d) => d.trim().replace(/^@/, "").toLowerCase())
                    .filter(Boolean),
                ),
              ];
              if (next.join() !== settings.allowedSignupDomains.join()) actions.updateSettings({ allowedSignupDomains: next });
            }}
          />
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold">Data</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Stored in Supabase: {data.employees.length} members, {data.leaves.length} leave records, {holidays.length} holidays.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => reload()}>
            Refresh from server
          </Button>
          <Button variant="secondary" onClick={backup}>
            Download backup (JSON)
          </Button>
        </div>
      </Card>

      <Modal open={editing !== null} title={editing === "new" ? "Add public holiday" : "Edit public holiday"} onClose={() => setEditing(null)}>
        {editing !== null && (
          <HolidayForm
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? undefined : editing}
            defaultDate={todayISO().startsWith(String(year)) ? todayISO() : `${year}-01-01`}
            onCancel={() => setEditing(null)}
            onSubmit={(input) => {
              if (editing === "new") actions.addHoliday(input);
              else actions.updateHoliday(editing.id, input);
              setEditing(null);
            }}
          />
        )}
      </Modal>

      <Modal open={deleting !== null} title="Delete holiday?" onClose={() => setDeleting(null)}>
        {deleting && (
          <div className="space-y-4 text-sm text-zinc-600">
            <p>
              <strong className="text-zinc-900">{deleting.name}</strong> will count as a normal working day again, which changes the duration
              of any leave that covers it.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  actions.deleteHoliday(deleting.id);
                  setDeleting(null);
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function HolidayForm({
  initial,
  defaultDate,
  onSubmit,
  onCancel,
}: {
  initial?: Holiday;
  defaultDate: string;
  onSubmit: (input: Omit<Holiday, "id">) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [startDate, setStartDate] = useState(initial?.startDate ?? defaultDate);
  const [endDate, setEndDate] = useState(initial?.endDate ?? defaultDate);
  const [error, setError] = useState("");

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setError("Enter a name");
        if (!startDate || !endDate || endDate < startDate) return setError("End date must be on or after the start date");
        onSubmit({ name: name.trim(), startDate, endDate });
      }}
    >
      <Field label="Name *">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Eid al-Fitr" autoFocus />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="From *">
          <input
            type="date"
            className={inputClass}
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (endDate < e.target.value) setEndDate(e.target.value);
            }}
          />
        </Field>
        <Field label="To *">
          <input type="date" className={inputClass} value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{initial ? "Save changes" : "Add holiday"}</Button>
      </div>
    </form>
  );
}
