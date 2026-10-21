# Team Leave Manager

Next.js 16 + Supabase app for tracking team leave: requests and approvals, half days and hourly permissions (Ozon), public holidays, annual balances, a team calendar, statistics and CSV/Excel export.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. In the Supabase SQL Editor, run the files in `supabase/migrations/` **in order** (paste the whole file, nothing highlighted, Run).
4. `npm run dev` and open http://localhost:3000.

### First admin

The first person to create an account becomes the **Admin**. If their email matches an existing team member, that record is promoted; otherwise one is created. After that, admins add team members (with their work email) on the Employees page, and each person signs up with that email to get access. Admins can promote others to Admin.

If Supabase's built-in email is used, confirmation emails only reach your project's team members and are rate limited. For a real team, either configure custom SMTP (Authentication → Emails → SMTP) or turn off "Confirm email" under Authentication → Providers → Email.

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
- **Annual balance** = allowance − approved days of the leave types chosen in Settings (default: Annual), per calendar year. Pending days are shown but not deducted.
- **Statistics** count approved records only. Occasions = number of records; days = working days inside the period.
- One person can't have overlapping requests, except two partial-day records on the same day (e.g. morning half-day plus an afternoon permission).

## Email notifications

Set `RESEND_API_KEY` (from [resend.com](https://resend.com)) and `NOTIFY_FROM_EMAIL` (a sender on a domain you've verified in Resend). Then:

- a new **Pending** request emails all active admins;
- approving or rejecting a request emails the employee.

Without a key, the app works normally and skips sending.

## Attachments

Sick leaves can carry a medical certificate (PDF or image, up to 10 MB) stored in the private `leave-attachments` Supabase Storage bucket. Only the employee and admins can open it, through short-lived signed links.
