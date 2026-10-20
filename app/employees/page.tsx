"use client";

import { useState } from "react";
import { EmployeeForm } from "@/components/EmployeeForm";
import { Button, Card, cx, EmptyState, inputClass, Loading, Modal, PageHeader } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { approved, isOnLeave, leaveDaysWithin, overlapsRange } from "@/lib/leave";
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
  const { employees, leaves, settings } = data;

  const today = todayISO();
  const yearStart = today.slice(0, 4) + "-01-01";
  const yearEnd = today.slice(0, 4) + "-12-31";
  const approvedLeaves = approved(leaves);

  const q = query.trim().toLowerCase();
  const visible = employees
    .filter((e) => (status === "all" ? true : status === "active" ? e.active : !e.active))
    .filter((e) => !q || [e.name, e.email, e.department, e.position].some((v) => v.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <PageHeader
        title="Employees"
        description="Add, edit, search and deactivate team members. Deactivated members keep their leave history."
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
                  <th className="px-4 py-3">Position</th>
                  <th className="px-4 py-3 text-right" title="Approved leaves this year">
                    Occasions ({today.slice(0, 4)})
                  </th>
                  <th className="px-4 py-3 text-right" title="Approved leave days this year">
                    Days ({today.slice(0, 4)})
                  </th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {visible.map((e) => {
                  const mine = approvedLeaves.filter((l) => l.employeeId === e.id);
                  const yearLeaves = mine.filter((l) => overlapsRange(l, yearStart, yearEnd));
                  const yearDays = yearLeaves.reduce((s, l) => s + leaveDaysWithin(l, yearStart, yearEnd, settings), 0);
                  const away = mine.some((l) => isOnLeave(l, today));
                  return (
                    <tr key={e.id} className={cx("hover:bg-zinc-50", !e.active && "text-zinc-400")}>
                      <td className="px-4 py-3">
                        <p className={cx("font-medium", e.active ? "text-zinc-900" : "text-zinc-500")}>{e.name}</p>
                        {e.email && <p className="text-xs text-zinc-500">{e.email}</p>}
                      </td>
                      <td className="px-4 py-3">{e.department || "—"}</td>
                      <td className="px-4 py-3">{e.position || "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{yearLeaves.length}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{yearDays}</td>
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
                          <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setConfirming(e)}>
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
              <strong className="text-zinc-900">{confirming.name}</strong> will be hidden from the active team and can no longer
              be assigned new leave. Their existing leave records and statistics are kept, and you can reactivate them at any time.
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
