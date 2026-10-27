// Server-only email sending. Imported by route handlers; never import from client components.
// Never throws: every outcome comes back as a SendResult, and failures are logged in plain language.
import nodemailer from "nodemailer";

export interface OutgoingEmail {
  to: string[];
  subject: string;
  html: string;
}

export interface FailedRecipient {
  to: string;
  error: string;
}

export type SendResult =
  /** Delivered to at least one recipient. `failed` lists any recipients Resend refused. */
  | { sent: true; via: "smtp" | "resend"; to: string[]; from: string; usedFallbackSender?: boolean; failed?: FailedRecipient[] }
  /** No email service configured: nothing was sent. */
  | { sent: false; reason: string; preview?: { to: string[]; subject: string } }
  /** The email service refused or failed for every recipient. */
  | { sent: false; error: string; failed?: FailedRecipient[] };

/** Resend's shared test sender. Works without a verified domain, but only delivers to the Resend account owner. */
export const FALLBACK_FROM = "Team Leave Manager <onboarding@resend.dev>";

export interface EmailDeps {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
}

/**
 * Sends with SMTP (Nodemailer) when SMTP_HOST is set, e.g. an Office 365 mailbox;
 * otherwise with Resend when RESEND_API_KEY is set. With neither, nothing is sent and
 * the result says what would have been sent.
 *
 * Resend safeguards:
 *  - If NOTIFY_FROM_EMAIL is rejected (unverified domain or invalid address), retry from
 *    onboarding@resend.dev.
 *  - If Resend is in testing mode (it only delivers to the account owner), send to each
 *    recipient separately, so whoever can receive still does and the rest are reported.
 */
export async function sendEmail(email: OutgoingEmail, deps: EmailDeps = {}): Promise<SendResult> {
  const env = deps.env ?? process.env;
  const to = [...new Set(email.to.map((t) => t.trim()).filter(Boolean))];
  if (!to.length) return { sent: false, reason: "No recipients" };

  if (env.SMTP_HOST) return sendSmtp({ ...email, to }, env);
  if (env.RESEND_API_KEY) return sendResend({ ...email, to }, env, deps.fetch ?? fetch);
  return {
    sent: false,
    reason: "Email is not configured (set SMTP_HOST or RESEND_API_KEY)",
    preview: { to, subject: email.subject },
  };
}

async function sendSmtp(email: OutgoingEmail, env: Record<string, string | undefined>): Promise<SendResult> {
  const from = env.NOTIFY_FROM_EMAIL || env.SMTP_USER || "Team Leave Manager";
  const port = Number(env.SMTP_PORT || 587);
  try {
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      // 465 = TLS from the start; 587/25 = STARTTLS upgrade.
      secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
    await transport.sendMail({ from, to: email.to, subject: email.subject, html: email.html });
    return { sent: true, via: "smtp", to: email.to, from };
  } catch (err) {
    const error = `The SMTP server refused the email: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[email] "${email.subject}" to ${email.to.join(", ")} not sent. ${error}`);
    return { sent: false, error };
  }
}

interface ResendAttempt {
  ok: boolean;
  status: number;
  message: string;
}

async function resendPost(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
  from: string,
  to: string[],
  email: OutgoingEmail,
): Promise<ResendAttempt> {
  const base = (env.RESEND_API_URL || "https://api.resend.com").replace(/\/+$/, "");
  try {
    const res = await fetchImpl(`${base}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: email.subject, html: email.html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true, status: res.status, message: "" };
    const text = await res.text().catch(() => "");
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      // not JSON: keep the raw text
    }
    return { ok: false, status: res.status, message: message || `HTTP ${res.status}` };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { ok: false, status: 0, message: timedOut ? "Resend didn't respond in time" : `Couldn't reach Resend (${err instanceof Error ? err.message : String(err)})` };
  }
}

/** Resend refuses non-owner recipients until a domain is verified. */
const isTestingModeBlock = (a: ResendAttempt) => /only send testing emails/i.test(a.message);
/** The configured sender can't be used (domain not verified, or not a valid address). */
const isSenderProblem = (a: ResendAttempt) =>
  !isTestingModeBlock(a) &&
  (a.status === 403 || a.status === 422 || a.status === 400) &&
  /domain.*(not verified|isn't verified|is not verified)|verify.*domain|invalid.*`?from`?|`?from`?.*invalid|from.*not allowed/i.test(a.message);

function explain(a: ResendAttempt): string {
  if (isTestingModeBlock(a))
    return "Resend is in testing mode, so it only delivers to the Resend account owner's address. Verify your domain at resend.com/domains to email everyone.";
  if (isSenderProblem(a)) return `Resend rejected the sender address: ${a.message}`;
  if (a.status === 401 || a.status === 403) return `Resend refused the API key (HTTP ${a.status}): ${a.message}`;
  if (a.status === 429) return "Resend's sending limit was reached. Try again in a minute.";
  if (a.status === 0) return a.message;
  return `Resend couldn't send the email (HTTP ${a.status}): ${a.message}`;
}

async function sendResend(email: OutgoingEmail, env: Record<string, string | undefined>, fetchImpl: typeof fetch): Promise<SendResult> {
  const preferred = env.NOTIFY_FROM_EMAIL?.trim() || FALLBACK_FROM;
  let from = preferred;
  let attempt = await resendPost(env, fetchImpl, from, email.to, email);

  // 1. Sender rejected → retry from Resend's shared sender.
  if (!attempt.ok && from !== FALLBACK_FROM && isSenderProblem(attempt)) {
    console.error(`[email] Sender "${from}" was rejected by Resend (${attempt.message}). Retrying from ${FALLBACK_FROM}.`);
    from = FALLBACK_FROM;
    attempt = await resendPost(env, fetchImpl, from, email.to, email);
  }
  const usedFallbackSender = from !== preferred;
  if (attempt.ok) return { sent: true, via: "resend", to: email.to, from, ...(usedFallbackSender && { usedFallbackSender }) };

  // 2. Testing mode with several recipients → one at a time, so the ones Resend allows still get it.
  if (isTestingModeBlock(attempt) && email.to.length > 1) {
    const delivered: string[] = [];
    const failed: FailedRecipient[] = [];
    for (const rcpt of email.to) {
      const one = await resendPost(env, fetchImpl, from, [rcpt], email);
      if (one.ok) delivered.push(rcpt);
      else failed.push({ to: rcpt, error: explain(one) });
    }
    if (failed.length)
      console.error(`[email] "${email.subject}": not delivered to ${failed.map((f) => f.to).join(", ")}. ${failed[0].error}`);
    if (delivered.length) return { sent: true, via: "resend", to: delivered, from, failed, ...(usedFallbackSender && { usedFallbackSender }) };
    return { sent: false, error: failed[0]?.error ?? explain(attempt), failed };
  }

  const error = explain(attempt);
  console.error(`[email] "${email.subject}" to ${email.to.join(", ")} not sent. ${error}`);
  return { sent: false, error, failed: email.to.map((t) => ({ to: t, error })) };
}
