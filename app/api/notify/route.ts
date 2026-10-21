import { createClient } from "@supabase/supabase-js";
import type { Database, LeaveNotification } from "@/lib/supabase/database.types";

/**
 * POST /api/notify  { leaveId, event: "submitted" | "decided" }
 * Authorization: Bearer <Supabase access token of the signed-in user>
 *
 * - submitted: emails all active admins (team leads) about a new Pending request.
 *   Allowed for the request's owner or an admin.
 * - decided:   emails the employee that their request was Approved / Rejected.
 *   Allowed for admins only.
 *
 * Who may see what is enforced by the database function leave_notification(),
 * which runs with the caller's own token. Emails are sent with Resend when
 * RESEND_API_KEY is set; otherwise the route reports what it would have sent.
 */
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: { leaveId?: unknown; event?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { leaveId, event } = body;
  if (typeof leaveId !== "string" || (event !== "submitted" && event !== "decided"))
    return Response.json({ error: "Expected { leaveId, event: 'submitted' | 'decided' }" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return Response.json({ error: "Supabase is not configured" }, { status: 500 });

  const sb = createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.rpc("leave_notification", { p_leave_id: leaveId });
  if (error) return Response.json({ error: error.message }, { status: error.code === "PGRST301" ? 401 : 500 });
  if (!data) return Response.json({ error: "Leave not found" }, { status: 404 });

  const info = data as LeaveNotification;
  const appUrl = process.env.APP_URL || new URL(request.url).origin;
  let email: { to: string[]; subject: string; html: string };

  if (event === "submitted") {
    if (info.leave.status !== "Pending") return Response.json({ error: "Leave is not pending" }, { status: 409 });
    const to = info.admins.map((a) => a.email).filter(Boolean);
    if (!to.length) return Response.json({ sent: false, reason: "No admin has an email address" });
    email = {
      to,
      subject: `New leave request: ${info.employee.name} – ${info.leave.type} (${dates(info)})`,
      html: layout(
        `New leave request from ${esc(info.employee.name)}`,
        details(info) + button(`${appUrl}/leaves`, "Review request"),
      ),
    };
  } else {
    if (!info.caller_is_admin) return Response.json({ error: "Only admins can send decision emails" }, { status: 403 });
    if (info.leave.status === "Pending") return Response.json({ error: "Leave has not been decided" }, { status: 409 });
    if (!info.employee.email) return Response.json({ sent: false, reason: "Employee has no email address" });
    const approved = info.leave.status === "Approved";
    email = {
      to: [info.employee.email],
      subject: `Your ${info.leave.type.toLowerCase()} leave request was ${info.leave.status.toLowerCase()} (${dates(info)})`,
      html: layout(
        `Your leave request was <span style="color:${approved ? "#047857" : "#b91c1c"}">${info.leave.status.toLowerCase()}</span>`,
        details(info) + button(`${appUrl}/leaves`, "View my leave"),
      ),
    };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return Response.json({ sent: false, reason: "Email is not configured (set RESEND_API_KEY)", preview: { to: email.to, subject: email.subject } });
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.NOTIFY_FROM_EMAIL || "Team Leave Manager <onboarding@resend.dev>",
      to: email.to,
      subject: email.subject,
      html: email.html,
    }),
  });
  if (!res.ok) return Response.json({ sent: false, error: `Email provider error: ${await res.text()}` }, { status: 502 });
  return Response.json({ sent: true, to: email.to });
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dates(info: LeaveNotification) {
  const { start_date, end_date } = info.leave;
  return start_date === end_date ? start_date : `${start_date} → ${end_date}`;
}

function duration(info: LeaveNotification) {
  const l = info.leave;
  if (l.duration_type === "half_am") return "Half-day (morning)";
  if (l.duration_type === "half_pm") return "Half-day (afternoon)";
  if (l.duration_type === "hourly") {
    const time = l.start_time && l.end_time ? ` (${l.start_time.slice(0, 5)}–${l.end_time.slice(0, 5)})` : "";
    return `Hourly permission: ${Number(l.hours)}h${time}`;
  }
  return "Full day(s)";
}

function details(info: LeaveNotification) {
  const rows: [string, string][] = [
    ["Employee", info.employee.name],
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

function button(href: string, label: string) {
  return `<p><a href="${esc(href)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">${label}</a></p>`;
}

function layout(title: string, body: string) {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18181b">
<h2 style="margin:0 0 8px;font-size:18px">${title}</h2>${body}
<p style="margin-top:24px;font-size:12px;color:#a1a1aa">Team Leave Manager</p></div>`;
}
