"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AttachmentLink, LeaveForm } from "@/components/LeaveForm";
import { matchesSquad, SquadBadge, SquadFilter, type SquadFilterValue } from "@/components/Squads";
import {
  Button,
  Card,
  cx,
  EmptyState,
  inputClass,
  Loading,
  Modal,
  PageHeader,
  StatusBadge,
  TypeBadge,
} from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { exportCSV, exportExcel } from "@/lib/export";
import { calendarDays, describeDuration, findTeamOverlaps, leaveDays, leaveHours } from "@/lib/leave";
import { actions, useAppData } from "@/lib/store";
import type { Leave, LeaveStatus, LeaveType } from "@/lib/types";
import { DURATION_LABELS, LEAVE_STATUSES, LEAVE_TYPES } from "@/lib/types";

export default function LeavesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <LeavesView />
    </Suspense>
  );
}

function LeavesView() {
  const data = useAppData();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [editing, setEditing] = useState<Leave | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Leave | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<LeaveType | "">("");
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [squadFilter, setSquadFilter] = useState<SquadFilterValue>("");

  if (!data) return <Loading />;
  const { employees, leaves, me } = data;
  const admin = me.role === "admin";

  // ?new=1 (from the dashboard) or ?new=1&date=YYYY-MM-DD (from the calendar) opens the form directly.
  const fromLink = searchParams.get("new") === "1";
  const formOpen = creating || fromLink || editing !== null;
  const closeForm = () => {
    setCreating(false);
    setEditing(null);
    if (fromLink) router.replace("/leaves");
  };

  const nameOf = (id: string) =>
    employees.find((e) => e.id === id)?.name ?? data.directory.find((e) => e.id === id)?.name ?? "Unknown";
  const q = query.trim().toLowerCase();
  const visible = leaves
    .filter((l) => !q || nameOf(l.employeeId).toLowerCase().includes(q) || l.notes.toLowerCase().includes(q))
    .filter((l) => !squadFilter || matchesSquad(employees.find((e) => e.id === l.employeeId)?.squadId, squadFilter))
    .filter((l) => !typeFilter || l.type === typeFilter)
    .filter((l) => !statusFilter || l.status === statusFilter)
    .filter((l) => !from || l.endDate >= from)
    .filter((l) => !to || l.startDate <= to)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  const hasFilters = q || typeFilter || statusFilter || from || to || squadFilter;
  const squadOf = (employeeId: string) => data.squads.find((s) => s.id === employees.find((e) => e.id === employeeId)?.squadId);
  const canEdit = (l: Leave) => admin || (l.employeeId === me.id && l.status === "Pending");

  const exportRows = () => {
    return [
      [
        "Employee",
        "Department",
        "Leave Type",
        "Duration Type",
        "Start Date",
        "End Date",
        "Leave Days",
        "Permission Hours",
        "Calendar Days",
        "Backup Person",
        "Status",
        "Has Attachment",
        "Notes",
      ],
      ...visible.map((l) => {
        const emp = employees.find((e) => e.id === l.employeeId);
        return [
          emp?.name ?? nameOf(l.employeeId),
          emp?.department ?? "",
          l.type,
          DURATION_LABELS[l.durationType],
          l.startDate,
          l.endDate,
          leaveDays(l, data),
          leaveHours(l),
          calendarDays(l.startDate, l.endDate),
          l.backupEmployeeId ? nameOf(l.backupEmployeeId) : "",
          l.status,
          l.attachmentPath ? "Yes" : "No",
          l.notes,
        ];
      }),
    ];
  };

  return (
    <div>
      <PageHeader
        title={admin ? "Leave Records" : "My Requests"}
        description={
          admin
            ? "All leave requests. Only approved leaves count towards statistics and balances."
            : "Your leave requests. You can edit or cancel a request while it's still pending."
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => exportCSV("leave-records.csv", exportRows())} disabled={!visible.length}>
              Export CSV
            </Button>
            <Button
              variant="secondary"
              onClick={() => exportExcel("leave-records.xls", [{ name: "Leave Records", rows: exportRows() }])}
              disabled={!visible.length}
            >
              Export Excel
            </Button>
            <Button onClick={() => setCreating(true)} disabled={admin && !employees.some((e) => e.active)}>
              {admin ? "+ New leave" : "+ Request leave"}
            </Button>
          </>
        }
      />

      <Card>
        <div className={cx("grid grid-cols-1 gap-3 border-b border-zinc-100 p-4 sm:grid-cols-2", admin ? "lg:grid-cols-7" : "lg:grid-cols-5")}>
          {admin && (
            <input
              className={cx(inputClass, "lg:col-span-2")}
              placeholder="Search employee or notes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          {!admin && (
            <input className={inputClass} placeholder="Search notes…" value={query} onChange={(e) => setQuery(e.target.value)} />
          )}
          {admin && <SquadFilter squads={data.squads} value={squadFilter} onChange={setSquadFilter} />}
          <select className={inputClass} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as LeaveType | "")}>
            <option value="">All types</option>
            {LEAVE_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select className={inputClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as LeaveStatus | "")}>
            <option value="">All statuses</option>
            {LEAVE_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" title="From" />
          <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" title="To" />
        </div>
        {hasFilters && (
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500">
            <span>
              Showing {visible.length} of {leaves.length} records
            </span>
            <button
              className="font-medium text-indigo-600 hover:underline"
              onClick={() => {
                setQuery("");
                setTypeFilter("");
                setStatusFilter("");
                setFrom("");
                setTo("");
                setSquadFilter("");
              }}
            >
              Clear filters
            </button>
          </div>
        )}

        {visible.length === 0 ? (
          <EmptyState>{leaves.length === 0 ? (admin ? "No leave records yet." : "You haven't requested any leave yet.") : "No records match your filters."}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                <tr>
                  {admin && <th className="px-4 py-3">Employee</th>}
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Dates</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Backup</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {visible.map((l) => {
                  const overlapCount = admin && l.status !== "Rejected" && l.durationType !== "hourly" ? findTeamOverlaps(l, leaves).length : 0;
                  return (
                    <tr key={l.id} className="hover:bg-zinc-50">
                      {admin && (
                        <td className="px-4 py-3 font-medium text-zinc-900">
                          <span className="flex flex-wrap items-center gap-1.5">
                            {nameOf(l.employeeId)}
                            <SquadBadge squad={squadOf(l.employeeId)} />
                          </span>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <TypeBadge type={l.type} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-600">
                        {formatDate(l.startDate)}
                        {l.endDate !== l.startDate && <> → {formatDate(l.endDate)}</>}
                        {overlapCount > 0 && (
                          <span
                            className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800"
                            title={`Overlaps with ${overlapCount} other leave(s)`}
                          >
                            ⚠ {overlapCount}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-700">{describeDuration(l, data)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-600">{l.backupEmployeeId ? nameOf(l.backupEmployeeId) : "—"}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={l.status} />
                      </td>
                      <td className="max-w-xs px-4 py-3 text-zinc-500">
                        <span className="block truncate" title={l.notes}>
                          {l.notes || (l.attachmentPath ? "" : "—")}
                        </span>
                        {l.attachmentPath && <AttachmentLink path={l.attachmentPath} compact />}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {admin && l.status === "Pending" && (
                          <>
                            <Button size="sm" variant="ghost" className="text-emerald-700" onClick={() => actions.updateLeave(l.id, { status: "Approved" })}>
                              Approve
                            </Button>
                            <Button size="sm" variant="ghost" className="text-zinc-500" onClick={() => actions.updateLeave(l.id, { status: "Rejected" })}>
                              Reject
                            </Button>
                          </>
                        )}
                        {canEdit(l) && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(l)}>
                              Edit
                            </Button>
                            <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setDeleting(l)}>
                              {admin ? "Delete" : "Cancel"}
                            </Button>
                          </>
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

      <Modal open={formOpen} title={editing ? "Edit leave" : admin ? "New leave" : "Request leave"} onClose={closeForm}>
        {formOpen && (
          <LeaveForm
            key={editing?.id ?? "new"}
            data={data}
            initial={editing ?? undefined}
            defaults={{ startDate: searchParams.get("date") ?? undefined }}
            onCancel={closeForm}
            onSubmit={(input, file) => {
              if (editing) actions.updateLeave(editing.id, input, file);
              else actions.addLeave(input, file);
              closeForm();
            }}
          />
        )}
      </Modal>

      <Modal open={deleting !== null} title={admin ? "Delete leave record?" : "Cancel this request?"} onClose={() => setDeleting(null)}>
        {deleting && (
          <div className="space-y-4 text-sm text-zinc-600">
            <p>
              {admin ? (
                <>
                  This permanently removes the {deleting.type.toLowerCase()} leave for{" "}
                  <strong className="text-zinc-900">{nameOf(deleting.employeeId)}</strong> ({formatDate(deleting.startDate)} →{" "}
                  {formatDate(deleting.endDate)}). To keep history, consider setting it to Rejected instead.
                </>
              ) : (
                <>
                  Your {deleting.type.toLowerCase()} request for {formatDate(deleting.startDate)}
                  {deleting.endDate !== deleting.startDate && ` → ${formatDate(deleting.endDate)}`} will be withdrawn.
                </>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                Keep it
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  actions.deleteLeave(deleting.id);
                  setDeleting(null);
                }}
              >
                {admin ? "Delete" : "Cancel request"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
