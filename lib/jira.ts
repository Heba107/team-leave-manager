// Server-only Jira Cloud client: open issues assigned to a person, looked up by email.
// Never throws — callers always get a result they can put in an email.

export interface JiraTask {
  key: string;
  title: string;
  status: string;
  /** "YYYY-MM-DD" or null */
  dueDate: string | null;
  priority: string | null;
  url: string;
}

export type JiraResult = { ok: true; tasks: JiraTask[]; jiraUser: string | null } | { ok: false; reason: string };

const TIMEOUT_MS = 8000;
const MAX_TASKS = 50;

interface JiraConfig {
  baseUrl: string;
  auth: string;
}

export function jiraConfig(env: Record<string, string | undefined> = process.env): JiraConfig | null {
  const domain = env.JIRA_DOMAIN?.trim();
  const email = env.JIRA_ADMIN_EMAIL?.trim();
  const token = env.JIRA_API_TOKEN?.trim();
  if (!domain || !email || !token) return null;
  // Accept "aman.atlassian.net", "https://aman.atlassian.net" or with a trailing slash.
  const baseUrl = (/^https?:\/\//i.test(domain) ? domain : `https://${domain}`).replace(/\/+$/, "");
  return { baseUrl, auth: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` };
}

async function jiraFetch(cfg: JiraConfig, path: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch) {
  return fetchImpl(`${cfg.baseUrl}${path}`, {
    ...init,
    headers: { Authorization: cfg.auth, Accept: "application/json", "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

interface RawIssue {
  key: string;
  fields?: {
    summary?: string;
    status?: { name?: string };
    duedate?: string | null;
    priority?: { name?: string } | null;
  };
}

/**
 * Open (not Done) Jira issues assigned to the person with this email.
 * Jira Cloud JQL can't match an assignee by email, so the account is looked up first.
 */
export async function openTasksForEmail(email: string, fetchImpl: typeof fetch = fetch, env = process.env): Promise<JiraResult> {
  const cfg = jiraConfig(env);
  if (!cfg) return { ok: false, reason: "Jira isn't configured (JIRA_DOMAIN, JIRA_ADMIN_EMAIL, JIRA_API_TOKEN)." };
  if (!email) return { ok: false, reason: "This person has no email address to look up in Jira." };
  try {
    const users = await jiraFetch(cfg, `/rest/api/3/user/search?query=${encodeURIComponent(email)}&maxResults=10`, {}, fetchImpl);
    if (!users.ok) return { ok: false, reason: `Jira user lookup failed (HTTP ${users.status}).` };
    const list = (await users.json()) as { accountId: string; emailAddress?: string; displayName?: string; active?: boolean }[];
    const user =
      list.find((u) => u.emailAddress?.toLowerCase() === email.toLowerCase()) ?? (list.length === 1 ? list[0] : undefined);
    if (!user) return { ok: false, reason: `No Jira account found for ${email}.` };

    const jql = `assignee = "${user.accountId}" AND statusCategory != Done ORDER BY duedate ASC, priority DESC, updated DESC`;
    const fields = ["summary", "status", "duedate", "priority"];
    // Current endpoint; older sites may still only offer /rest/api/3/search.
    let res = await jiraFetch(cfg, "/rest/api/3/search/jql", { method: "POST", body: JSON.stringify({ jql, fields, maxResults: MAX_TASKS }) }, fetchImpl);
    if (res.status === 404 || res.status === 410) {
      res = await jiraFetch(cfg, "/rest/api/3/search", { method: "POST", body: JSON.stringify({ jql, fields, maxResults: MAX_TASKS }) }, fetchImpl);
    }
    if (!res.ok) return { ok: false, reason: `Jira search failed (HTTP ${res.status}).` };
    const body = (await res.json()) as { issues?: RawIssue[] };
    const tasks = (body.issues ?? []).map((i) => ({
      key: i.key,
      title: i.fields?.summary ?? "(no title)",
      status: i.fields?.status?.name ?? "Unknown",
      dueDate: i.fields?.duedate ?? null,
      priority: i.fields?.priority?.name ?? null,
      url: `${cfg.baseUrl}/browse/${encodeURIComponent(i.key)}`,
    }));
    return { ok: true, tasks, jiraUser: user.displayName ?? null };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { ok: false, reason: timedOut ? "Jira didn't respond in time." : `Couldn't reach Jira (${err instanceof Error ? err.message : String(err)}).` };
  }
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** HTML block for emails: a task table, an "all clear" line, or the fallback note. */
export function jiraTasksHtml(result: JiraResult, leave: { start_date: string; end_date: string }): string {
  if (!result.ok) {
    return `<p style="margin:16px 0;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:13px;color:#92400e">
Jira tasks could not be fetched: ${esc(result.reason)} The leave itself is approved; please check open work with them directly.</p>`;
  }
  if (!result.tasks.length) return `<p style="margin:16px 0;font-size:14px;color:#047857">No open Jira tasks are assigned to them.</p>`;
  const rows = result.tasks
    .map((t) => {
      const dueInLeave = t.dueDate && t.dueDate >= leave.start_date && t.dueDate <= leave.end_date;
      const due = t.dueDate ? `${esc(t.dueDate)}${dueInLeave ? ' <strong style="color:#b91c1c">(during leave)</strong>' : ""}` : "—";
      return `<tr>
<td style="padding:6px 10px 6px 0;white-space:nowrap"><a href="${esc(t.url)}" style="color:#4f46e5">${esc(t.key)}</a></td>
<td style="padding:6px 10px 6px 0">${esc(t.title)}</td>
<td style="padding:6px 10px 6px 0;white-space:nowrap">${esc(t.status)}</td>
<td style="padding:6px 0;white-space:nowrap">${due}</td></tr>`;
    })
    .join("");
  return `<p style="margin:16px 0 4px;font-size:14px;font-weight:600">Open Jira tasks (${result.tasks.length})</p>
<table style="border-collapse:collapse;font-size:13px;width:100%">
<tr style="color:#71717a;text-align:left"><th style="padding:4px 10px 4px 0">Key</th><th style="padding:4px 10px 4px 0">Title</th><th style="padding:4px 10px 4px 0">Status</th><th style="padding:4px 0">Due</th></tr>
${rows}</table>`;
}
