import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { openTasksForEmail } from "@/lib/jira";
import { button, dates, details, esc, handoverEmail, layout } from "@/lib/leaveEmails";
import type { Database, LeaveNotification } from "@/lib/supabase/database.types";

/**
 * POST /api/notify  { leaveId, event: "submitted" | "decided" }
 * Authorization: Bearer <Supabase access token of the signed-in user>
 *
 * - submitted: emails the people chosen by leave_notification() about a new
 *   Pending request: an employee's direct manager + the General Manager, or only
 *   the General Manager for a team lead's own request (falls back to the other
 *   admins if neither is set). Allowed for the request's owner or an admin.
 * - decided:   emails the employee that their request was Approved / Rejected.
 *   On approval it also emails the direct manager, squad lead and squad focal point a handover with
 *   the employee's open Jira tasks (or a note if Jira couldn't be reached).
 *   Allowed for admins only.
 *
 * Who may see what is enforced by the database function leave_notification(),
 * which runs with the caller's own token. Emails go out through SMTP or Resend
 * (see lib/email.ts); if neither is configured the route reports what it would
 * have sent.
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
    const to = [...new Set(info.recipients.map((r) => r.email).filter(Boolean))];
    if (!to.length) return Response.json({ sent: false, reason: "No manager, General Manager or admin with an email address" });
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

  const result = await sendEmail(email);
  const extra: Record<string, unknown> = event === "submitted" ? { rule: info.recipient_rule } : {};

  // Approved: handover with open Jira tasks for the direct manager and squad lead.
  // Jira problems never fail the request; the email says the tasks couldn't be fetched.
  if (event === "decided" && info.leave.status === "Approved") {
    const to = [...new Set(info.handover_recipients.map((r) => r.email).filter(Boolean))];
    if (to.length) {
      const jira = await openTasksForEmail(info.employee.email);
      const handover = await sendEmail({ to, ...handoverEmail(info, jira, appUrl, "approved") });
      extra.handover = { ...handover, jira: jira.ok ? { ok: true, tasks: jira.tasks.length } : jira };
    } else {
      extra.handover = { sent: false, reason: "No direct manager, squad lead or focal point with an email address" };
    }
  }

  if ("error" in result) return Response.json({ ...result, ...extra }, { status: 502 });
  return Response.json({ ...result, ...extra });
}
