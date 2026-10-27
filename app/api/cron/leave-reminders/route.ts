import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { openTasksForEmail } from "@/lib/jira";
import { handoverEmail } from "@/lib/leaveEmails";
import type { Database } from "@/lib/supabase/database.types";

/**
 * GET /api/cron/leave-reminders — daily handover reminder (scheduled in vercel.json).
 *
 * Finds Approved leave (full or half day) starting exactly 3 days from today in Cairo,
 * fetches each person's open Jira tasks, and emails a handover summary to their
 * direct manager and squad lead (the General Manager if neither is set). Each leave
 * is reminded once: handover_reminder_sent_at is set after a successful send.
 *
 * Auth: "Authorization: Bearer <CRON_SECRET>" (Vercel Cron sends this automatically).
 * Testing: ?dryRun=1 lists what would be sent without sending; ?date=YYYY-MM-DD
 * checks leave starting on that date instead of today + 3.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 503 });
  const sb = createClient<Database>(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dryRun") === "1";
  const override = params.get("date");
  if (override && !/^\d{4}-\d{2}-\d{2}$/.test(override)) return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  const target = override ?? addDays(cairoToday(), 3);
  const appUrl = process.env.APP_URL || new URL(request.url).origin;

  const { data: leaves, error } = await sb
    .from("leaves")
    .select("*")
    .eq("status", "Approved")
    .eq("start_date", target)
    .neq("duration_type", "hourly")
    .is("handover_reminder_sent_at", null);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const [{ data: employees }, { data: squads }, { data: settings }] = await Promise.all([
    sb.from("employees").select("*"),
    sb.from("squads").select("*"),
    sb.from("app_settings").select("general_manager_id").eq("id", 1).maybeSingle(),
  ]);
  const byId = new Map((employees ?? []).map((e) => [e.id, e]));
  const usable = (id: string | null | undefined, exclude: string) => {
    const p = id ? byId.get(id) : undefined;
    return p && p.active && p.email && p.id !== exclude ? p : undefined;
  };

  const results = [];
  for (const l of leaves ?? []) {
    const emp = byId.get(l.employee_id);
    if (!emp || !emp.active) continue;
    const squad = (squads ?? []).find((s) => s.id === emp.squad_id);
    let recipients = [usable(emp.manager_id, emp.id), usable(squad?.lead_id, emp.id)].filter((p) => !!p);
    let fallback = false;
    if (!recipients.length) {
      const gm = usable(settings?.general_manager_id, emp.id);
      recipients = gm ? [gm] : [];
      fallback = true;
    }
    const to = [...new Set(recipients.map((p) => p.email))];
    const entry: Record<string, unknown> = { leaveId: l.id, employee: emp.name, start: l.start_date, end: l.end_date, to, fallbackToGM: fallback };
    if (!to.length) {
      results.push({ ...entry, sent: false, reason: "No manager, squad lead or General Manager with an email address" });
      continue;
    }

    const jira = await openTasksForEmail(emp.email);
    entry.jira = jira.ok ? { ok: true, tasks: jira.tasks.length } : jira;
    if (dryRun) {
      results.push({ ...entry, sent: false, dryRun: true });
      continue;
    }
    const info = {
      leave: {
        id: l.id,
        type: l.type,
        status: l.status,
        start_date: l.start_date,
        end_date: l.end_date,
        duration_type: l.duration_type,
        start_time: l.start_time,
        end_time: l.end_time,
        hours: l.hours,
        notes: l.notes,
        has_attachment: !!l.attachment_path,
      },
      employee: { name: emp.name, email: emp.email },
      backup: l.backup_employee_id ? (byId.get(l.backup_employee_id)?.name ?? null) : null,
      squad: squad?.name ?? null,
    };
    const sent = await sendEmail({ to, ...handoverEmail(info, jira, appUrl, "reminder") });
    if (sent.sent) await sb.from("leaves").update({ handover_reminder_sent_at: new Date().toISOString() }).eq("id", l.id);
    results.push({ ...entry, ...sent });
  }

  return Response.json({ date: target, dryRun, checked: leaves?.length ?? 0, results });
}

function cairoToday(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
