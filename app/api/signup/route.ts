import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * POST /api/signup  { name, email, password }
 *
 * Creates an already-confirmed account with the Supabase admin API, so no
 * confirmation email is sent (and Supabase's email rate limit never applies).
 * The browser then signs in with the same email and password.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY (server-only; set it in Vercel's
 * environment variables too). Without it the route answers
 * 503 { code: "not_configured" }. The app never falls back to Supabase's
 * client-side sign-up, which would send confirmation emails.
 *
 * Allowed email domains come from app_settings.allowed_signup_domains; the
 * database trigger on auth.users enforces the same rule for every sign-up path.
 */
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return Response.json({ code: "not_configured", error: "Instant sign-up isn't configured on the server." }, { status: 503 });
  }

  let body: { name?: unknown; email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!name) return Response.json({ error: "Enter your name." }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  if (password.length < 8 || password.length > 72)
    return Response.json({ error: "Password must be 8–72 characters." }, { status: 400 });

  const admin = createClient<Database>(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const settings = await admin.from("app_settings").select("allowed_signup_domains").eq("id", 1).maybeSingle();
  if (settings.error) return Response.json({ error: "Couldn't check sign-up settings." }, { status: 500 });
  const domains = (settings.data?.allowed_signup_domains ?? []).map((d) => d.replace(/^@/, "").toLowerCase());
  if (domains.length && !domains.includes(email.split("@")[1])) {
    return Response.json(
      { code: "domain_not_allowed", error: `Sign-ups are limited to ${domains.map((d) => "@" + d).join(", ")} email addresses.` },
      { status: 403 },
    );
  }

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error) {
    if (error.code === "email_exists" || /already (been )?registered|already exists/i.test(error.message))
      return Response.json(
        { code: "email_exists", error: "An account with this email already exists. Sign in, or use “Forgot password?”." },
        { status: 409 },
      );
    if (error.code === "weak_password") return Response.json({ code: error.code, error: error.message }, { status: 400 });
    console.error("signup: createUser failed", error.code, error.message);
    return Response.json({ error: "Couldn't create the account. Please try again." }, { status: 500 });
  }
  return Response.json({ ok: true }, { status: 201 });
}
