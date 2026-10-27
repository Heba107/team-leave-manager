import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { button, esc, layout } from "@/lib/leaveEmails";
import type { Database } from "@/lib/supabase/database.types";

/**
 * POST /api/password-reset  { email }
 *
 * Creates a one-time recovery link with the Supabase admin API (generateLink, using
 * SUPABASE_SERVICE_ROLE_KEY) and emails it through the app's email service
 * (lib/email.ts: SMTP or Resend). Supabase sends nothing, so its email rate limits
 * never apply and many people can reset at once.
 *
 * The link opens APP_URL/reset-password with a token_hash, so it works in any browser.
 * Always answers the same way whether or not the account exists, so the form can't be
 * used to find out who has an account.
 */

// Per-address throttle (per server instance): stops repeated clicks emailing someone
// many times. It never blocks other people.
const lastSent = new Map<string, number>();
const THROTTLE_MS = 60_000;

const OK_MESSAGE = "If an account exists for that email, a password reset link is on its way.";

export async function POST(request: Request) {
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("[password-reset] Not sent: SUPABASE_SERVICE_ROLE_KEY (or the Supabase URL) is missing on the server.");
    return Response.json(
      { code: "not_configured", error: "Password reset isn't set up on the server yet. Please contact your team lead." },
      { status: 503 },
    );
  }
  if (!process.env.RESEND_API_KEY && !process.env.SMTP_HOST) {
    console.error("[password-reset] Not sent: no email service configured (set RESEND_API_KEY or SMTP_HOST).");
    return Response.json(
      { code: "not_configured", error: "Password reset emails aren't set up yet. Please contact your team lead." },
      { status: 503 },
    );
  }

  const now = Date.now();
  if (now - (lastSent.get(email) ?? 0) < THROTTLE_MS) {
    return Response.json({ error: "A reset email was just sent to this address. Please wait a minute before asking again." }, { status: 429 });
  }

  const appUrl = (process.env.APP_URL || new URL(request.url).origin).replace(/\/+$/, "");
  const admin = createClient<Database>(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${appUrl}/reset-password` },
  });
  if (error || !data.properties?.hashed_token) {
    // Unknown address (or a disabled account): same answer as success, but note real failures.
    if (error && !/not.?found|no user|user.*not exist/i.test(error.message))
      console.error(`[password-reset] Couldn't create a reset link for ${email}: ${error.message}`);
    return Response.json({ ok: true, message: OK_MESSAGE });
  }

  const link = `${appUrl}/reset-password?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`;
  const name = (data.user.user_metadata?.name as string | undefined) ?? "";
  const sent = await sendEmail({
    to: [email],
    subject: "Reset your Team Leave password",
    html: layout(
      "Reset your password",
      `<p style="font-size:14px">Hi${name ? ` ${esc(name)}` : ""}, we got a request to reset the password for <strong>${esc(email)}</strong>.</p>` +
        button(link, "Choose a new password") +
        `<p style="font-size:13px;color:#71717a">The link works once and expires in 1 hour. If you didn't ask for this, you can ignore this email; your password won't change.</p>`,
    ),
  });
  if (!sent.sent) {
    const why = "error" in sent ? sent.error : sent.reason;
    console.error(`[password-reset] Reset email to ${email} was not delivered. ${why}`);
    return Response.json(
      { error: "We couldn't send the reset email right now. Please try again later or contact your team lead." },
      { status: 502 },
    );
  }
  lastSent.set(email, now);
  return Response.json({ ok: true, message: OK_MESSAGE });
}
