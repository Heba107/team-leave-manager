import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * POST /api/password-reset  { email }
 *
 * Asks Supabase Auth to email a password-reset link (resetPasswordForEmail). The email
 * is sent by Supabase, so Supabase needs working email delivery: configure custom SMTP
 * under Authentication → Emails → SMTP Settings. The link opens APP_URL/reset-password,
 * which must be listed under Authentication → URL Configuration → Redirect URLs.
 *
 * Always answers the same way whether or not the account exists, so the form can't
 * be used to find out who has an account.
 */

// Simple per-instance throttle: one reset request per address per minute.
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
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return Response.json({ code: "not_configured", error: "Supabase is not configured." }, { status: 503 });

  const now = Date.now();
  if (now - (lastSent.get(email) ?? 0) < THROTTLE_MS) {
    return Response.json({ error: "A reset email was just sent. Please wait a minute before asking again." }, { status: 429 });
  }

  // APP_URL is the public address of the app (e.g. https://team-leave.vercel.app).
  const appUrl = (process.env.APP_URL || new URL(request.url).origin).replace(/\/+$/, "");
  // Server-side request: the link carries the session in the URL (implicit flow), since
  // there's no browser here to hold a PKCE code verifier. /reset-password handles it.
  const sb = createClient<Database>(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, flowType: "implicit" } });
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${appUrl}/reset-password` });

  if (error) {
    console.error("password-reset: resetPasswordForEmail failed", error.status, error.code, error.message);
    if (error.status === 429 || /rate limit/i.test(error.message))
      return Response.json({ error: "Too many reset emails were requested. Please wait a while and try again." }, { status: 429 });
    return Response.json(
      { error: "We couldn't send the reset email right now. Please try again later or contact your team lead." },
      { status: 502 },
    );
  }
  lastSent.set(email, now);
  return Response.json({ ok: true, message: OK_MESSAGE });
}
