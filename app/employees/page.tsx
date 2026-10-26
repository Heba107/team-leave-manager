"use client";

import { useState } from "react";
import { EmployeeForm } from "@/components/EmployeeForm";
import { Button, Card, cx, EmptyState, inputClass, Loading, Modal, PageHeader } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { annualBalance, approved, formatDays, formatHours, isOnLeave } from "@/lib/leave";
import { actions, useAppData } from "@/lib/store";
import type { Employee } from "@/lib/types";

type StatusFilter = "active" | "inactive" | "all";

export default function EmployeesPage() {
  const data = useAppData();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [editing, setEditing] = useState<Employee | "new" | null>(null);
  const [confirming, setConfirming] = useState<Employee | null>(null);

  if (!data) return <Loading />;
  const { employees, leaves, me } = data;

  const today = todayISO();
  const year = Number(today.slice(0, 4));
  const approvedLeaves = approved(leaves);
  const activeAdmins = employees.filter((e) => e.active && e.role === "admin").length;

  const q = query.trim().toLowerCase();
  const visible = employees
    .filter((e) => (status === "all" ? true : status === "active" ? e.active : !e.active))
    .filter((e) => !q || [e.name, e.email, e.department, e.position].some((v) => v.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <PageHeader
        title="Employees"
        description={`Manage team members, roles and ${year} annual allowances. Deactivated members keep their leave history.`}
        actions={<Button onClick={() => setEditing("new")}>+ Add member</Button>}
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-zinc-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <input
            className={cx(inputClass, "sm:max-w-xs")}
            placeholder="Search name, email, department…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="inline-flex rounded-lg bg-zinc-100 p-1 text-sm">
            {(["active", "inactive", "all"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={cx(
                  "rounded-md px-3 py-1 font-medium capitalize",
                  status === s ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <EmptyState>{employees.length === 0 ? "No team members yet. Add your first one." : "No members match your filters."}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3 text-right" title="Annual leave allowance">
                    Allowance
                  </th>
                  <th className="px-4 py-3 text-right" title={`Unused ${year - 1} days, usable for leave dated until 31 Mar ${year}`}>
                    Carried
                  </th>
                  <th className="px-4 py-3 text-right" title={`Approved ${data.settings.deductingTypes.join(" + ")} days in ${year}`}>
                    Used
                  </th>
                  <th className="px-4 py-3 text-right" title="This year's allowance left + carried days still valid (pending not yet deducted)">
                    Remaining
                  </th>
                  <th className="px-4 py-3 text-right" title={`Approved hourly permissions in ${year}`}>
                    Permissions
                  </th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {visible.map((e) => {
                  const b = annualBalance(e, leaves, year, data);
                  const away = approvedLeaves.some((l) => l.employeeId === e.id && isOnLeave(l, today) && l.durationType === "full");
                  const lastAdmin = e.role === "admin" && e.active && activeAdmins <= 1;
                  return (
                    <tr key={e.id} className={cx("hover:bg-zinc-50", !e.active && "text-zinc-400")}>
                      <td className="px-4 py-3">
                        <p className={cx("font-medium", e.active ? "text-zinc-900" : "text-zinc-500")}>
                          {e.name}
                          {e.role === "admin" && (
                            <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">Admin</span>
                          )}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {e.email || "no email"}
                          {e.email && (e.userId ? <span title="Has signed up"> · ✓ account</span> : <span title="Hasn't signed up yet"> · not signed up</span>)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {e.department || "—"}
                        {e.position && <p className="text-xs text-zinc-500">{e.position}</p>}
                        <p className="text-xs text-zinc-500">
                          {e.id === data.settings.generalManagerId
                            ? "General Manager"
                            : `Manager: ${employees.find((m) => m.id === e.managerId)?.name ?? "—"}`}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatDays(b.allowance)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {b.carriedIn ? formatDays(b.carriedIn) : "—"}
                        {b.carriedIn > 0 && (
                          <span className="block text-xs text-zinc-400">
                            {b.carriedExpired > 0
                              ? `${formatDays(b.carriedExpired)} expired`
                              : b.carriedAvailable > 0
                                ? `${formatDays(b.carriedAvailable)} left`
                                : "all used"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatDays(b.used)}
                        {b.pending > 0 && <span className="block text-xs text-zinc-400">+{formatDays(b.pending)} pending</span>}
                      </td>
                      <td
                        className={cx(
                          "px-4 py-3 text-right font-semibold tabular-nums",
                          b.remaining < 0 ? "text-rose-700" : b.remaining <= 3 ? "text-amber-700" : "text-zinc-900",
                        )}
                      >
                        {formatDays(b.remaining)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-zinc-600">{b.permissionHours ? formatHours(b.permissionHours) : "—"}</td>
                      <td className="px-4 py-3">
                        {!e.active ? (
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">Inactive</span>
                        ) : away ? (
                          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">On leave</span>
                        ) : (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Available</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
                          Edit
                        </Button>
                        {e.active ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-rose-600"
                            disabled={e.id === me.id || lastAdmin}
                            title={e.id === me.id ? "You can't deactivate yourself" : lastAdmin ? "At least one admin is required" : undefined}
                            onClick={() => setConfirming(e)}
                          >
                            Deactivate
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" className="text-emerald-700" onClick={() => actions.updateEmployee(e.id, { active: true })}>
                            Reactivate
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={editing !== null} title={editing === "new" ? "Add team member" : "Edit team member"} onClose={() => setEditing(null)}>
        {editing !== null && (
          <EmployeeForm
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? undefined : editing}
            existing={employees}
            isSelf={editing !== "new" && editing.id === me.id}
            onCancel={() => setEditing(null)}
            onSubmit={(input) => {
              if (editing === "new") actions.addEmployee(input);
              else actions.updateEmployee(editing.id, input);
              setEditing(null);
            }}
          />
        )}
      </Modal>

      <Modal open={confirming !== null} title="Deactivate team member?" onClose={() => setConfirming(null)}>
        {confirming && (
          <div className="space-y-4 text-sm text-zinc-600">
            <p>
              <strong className="text-zinc-900">{confirming.name}</strong> will lose access to the app and can no longer be assigned new
              leave. Their existing leave records and statistics are kept, and you can reactivate them at any time.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  actions.updateEmployee(confirming.id, { active: false });
                  setConfirming(null);
                }}
              >
                Deactivate
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
