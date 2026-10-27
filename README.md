# Team Leave Manager

Next.js 16 + Supabase app for tracking team leave: requests and approvals, half days and hourly permissions (Ozon), public holidays, annual balances, a team calendar, statistics and CSV/Excel export.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. In the Supabase SQL Editor, run the files in `supabase/migrations/` **in order** (paste the whole file, nothing highlighted, Run).
4. `npm run dev` and open http://localhost:3000.

### Accounts and the first admin

Anyone can create an account from the login screen and gets access right away as an **Employee**: if an admin already added a team member with that email, the account is linked to it; otherwise a new team member record is created. The very first account, while no admin exists, becomes the **Admin**. Admins can promote others on the Employees page, and deactivating someone there removes their access.

Sign-ups go through `/api/signup`, which creates the account already confirmed with the Supabase admin API, so no confirmation email is sent and Supabase's email rate limit doesn't apply. This needs `SUPABASE_SERVICE_ROLE_KEY` on the server (see `.env.example`), including in your hosting provider's environment variables (Vercel: Project → Settings → Environment Variables, then redeploy). Without it, sign-up shows an error; the app never uses Supabase's client-side sign-up.

Only email domains listed in Settings → **Who can sign up** may create accounts (default `aman.eg`). The database enforces this for every sign-up path, including Supabase's public sign-up endpoint.

Because accounts aren't email-verified, someone could register a colleague's address before they do. Ask team members to create their accounts promptly, and check new names on the Employees page.

### Password reset

"Forgot password?" calls `/api/password-reset`, which creates a one-time link with the Supabase admin API and sends it through the app's own email service (SMTP or Resend, see below). The link opens `/reset-password`, where the person chooses a new password. It works in any browser, works once, and expires after 1 hour. If the app's email service isn't configured, the app falls back to Supabase's own mailer, which needs custom SMTP set up in Supabase (Authentication → Emails → SMTP Settings).

In Supabase → Authentication → URL Configuration, set **Site URL** to your production URL and add `https://<your-domain>/reset-password` and `http://localhost:3000/reset-password` to **Redirect URLs**.

## Roles

| | Admin (team lead) | Employee |
|---|---|---|
| Submit leave requests | for anyone | for themselves (always Pending) |
| Approve / reject | ✓ | — |
| Edit / cancel | any request | own requests while Pending |
| See leave records & calendar | whole team | own only |
| Employees, statistics, settings, holidays | ✓ | — |

The rules are enforced by Postgres row-level security and triggers, not just the UI.

## Leave rules

- **Leave days** exclude configured weekend days and public holidays. A half day counts as 0.5.
- **Hourly permissions (Ozon)** are tracked in hours, separately from days, and never reduce the annual balance.
- **Annual balance** = allowance − approved days of the leave types chosen in Settings (default: Annual, Sick and Emergency), per calendar year. Pending days are shown but not deducted. Leave is always charged to the year its dates fall in (a leave from 28 Dec to 3 Jan is split across both years).
- **Carry forward** (Settings → Annual balance rules): on 1 January, each person's unused allowance from the previous year is added to their balance. Leave dated 1 Jan–31 Mar uses those carried days first; any carried days still unused expire on 1 April, leaving only the current year's allowance. Carrying starts from the year set in Settings (default 2026, so unused 2026 days are usable until 31 Mar 2027). Balances are worked out from leave dates, so nothing needs to run on 1 January or 1 April.
- **2026 opening balance** (Employees → Edit): because the app was adopted in October 2026, admins can enter the days each person actually had left in 2026 before leave was tracked here. It replaces the allowance as their 2026 starting balance; 2026 leave recorded in the app is deducted from it, and the rest carries into Q1 2027. Leave it empty to use the normal allowance.
- **Approvals:** any admin can approve or reject any request, including their own. Team leads don't need the General Manager's approval.
- **Statistics** count approved records only. Occasions = number of records; days = working days inside the period.
- One person can't have overlapping requests, except two partial-day records on the same day (e.g. morning half-day plus an afternoon permission).

## Email notifications

Configure either SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, e.g. an Office 365 mailbox) or Resend (`RESEND_API_KEY`), plus `NOTIFY_FROM_EMAIL`; see `.env.example`. Without either, the app works normally and skips sending.

Who gets the email about a new **Pending** request:

| Requester | Emailed |
|---|---|
| Employee | their **direct manager** (Employees page) + the **General Manager** (Settings) |
| Team lead (admin) | the General Manager only |
| Nobody found (no manager/GM set, or the GM's own request) | all other active admins |

Approving or rejecting a request emails the employee. Emails only decide who is notified: every admin still sees and can manage every request.

## Squads

Admins create, rename and delete squads under Employees → **Manage squads**. There they pick a **squad lead** (an admin) and an optional **focal point** (a regular member of that squad), and they assign each person to one squad in their profile. A focal point who moves to another squad is cleared automatically. Squad badges and a squad filter appear on the Employees page and the Leave Records board. Squads don't change approvals or request emails, which still follow the direct manager and General Manager.

## Jira handover emails

With `JIRA_DOMAIN`, `JIRA_ADMIN_EMAIL` and `JIRA_API_TOKEN` set, the app looks up the employee's open Jira issues by their email address:

- **On approval:** the employee's direct manager, squad lead and squad focal point get a handover email listing each open task's key, title, status and due date, with links. Tasks due during the leave are highlighted.
- **3 days before the leave starts:** a daily job (`/api/cron/leave-reminders`, 07:00 UTC in `vercel.json`, which is 09:00 in Cairo in winter and 10:00 in summer) sends the same summary as a reminder. Each leave gets one reminder. If no manager, squad lead or focal point is set, the General Manager gets it. Set `CRON_SECRET` in Vercel so only Vercel can trigger the job.

If Jira isn't configured or doesn't respond within 8 seconds, the approval goes through normally and the email says the tasks couldn't be fetched.

## Attachments

Sick leaves can carry a medical certificate (PDF or image, up to 10 MB) stored in the private `leave-attachments` Supabase Storage bucket. Only the employee and admins can open it, through short-lived signed links.
