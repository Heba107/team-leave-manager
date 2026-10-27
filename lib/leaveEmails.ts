// Email templates for leave notifications (server-only).
import { jiraTasksHtml, type JiraResult } from "./jira";
import type { LeaveNotification } from "./supabase/database.types";

/** The parts of a leave notification the templates need. */
export type LeaveEmailInfo = Pick<LeaveNotification, "leave" | "employee" | "backup"> & { squad?: string | null };

export function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function dates(info: LeaveEmailInfo) {
  const { start_date, end_date } = info.leave;
  return start_date === end_date ? start_date : `${start_date} → ${end_date}`;
}

function duration(info: LeaveEmailInfo) {
  const l = info.leave;
  if (l.duration_type === "half_am") return "Half-day (morning)";
  if (l.duration_type === "half_pm") return "Half-day (afternoon)";
  if (l.duration_type === "hourly") {
    const time = l.start_time && l.end_time ? ` (${l.start_time.slice(0, 5)}–${l.end_time.slice(0, 5)})` : "";
    return `Hourly permission: ${Number(l.hours)}h${time}`;
  }
  return "Full day(s)";
}

export function details(info: LeaveEmailInfo) {
  const rows: [string, string][] = [
    ["Employee", info.employee.name],
    ...(info.squad ? ([["Squad", info.squad]] as [string, string][]) : []),
    ["Type", info.leave.type],
    ["Dates", dates(info)],
    ["Duration", duration(info)],
    ["Status", info.leave.status],
  ];
  if (info.backup) rows.push(["Backup / handover", info.backup]);
  if (info.leave.notes) rows.push(["Notes", info.leave.notes]);
  if (info.leave.has_attachment) rows.push(["Attachment", "Medical certificate attached (view in the app)"]);
  return `<table style="border-collapse:collapse;margin:16px 0;font-size:14px">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#71717a">${k}</td><td style="padding:4px 0;color:#18181b">${esc(v)}</td></tr>`,
    )
    .join("")}</table>`;
}

export function button(href: string, label: string) {
  return `<p><a href="${esc(href)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">${label}</a></p>`;
}

export function layout(title: string, body: string) {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18181b">
<h2 style="margin:0 0 8px;font-size:18px">${title}</h2>${body}
<p style="margin-top:24px;font-size:12px;color:#a1a1aa">Team Leave Manager</p></div>`;
}

/**
 * Handover email for the direct manager and squad lead, listing the employee's open Jira tasks.
 * kind "approved": sent when the leave is approved; "reminder": 3 days before it starts.
 */
export function handoverEmail(info: LeaveEmailInfo, jira: JiraResult, appUrl: string, kind: "approved" | "reminder") {
  const who = esc(info.employee.name);
  const title =
    kind === "approved"
      ? `${who}'s leave was approved: handover`
      : `${who} starts leave on ${esc(info.leave.start_date)}: handover reminder`;
  const intro =
    kind === "approved"
      ? `<p style="font-size:14px">${who}'s leave is approved. Here's what they have open in Jira so work can be covered while they're away.</p>`
      : `<p style="font-size:14px">${who}'s approved leave starts in 3 days. Please agree a handover for their open Jira tasks before then.</p>`;
  return {
    subject:
      kind === "approved"
        ? `Handover: ${info.employee.name} on leave ${dates(info)}`
        : `Reminder: ${info.employee.name} on leave from ${info.leave.start_date} – handover`,
    html: layout(title, intro + details(info) + jiraTasksHtml(jira, info.leave) + button(`${appUrl}/leaves`, "Open the leave board")),
  };
}
