// Server-only email sending. Imported by route handlers; never import from client components.
import nodemailer from "nodemailer";

export interface OutgoingEmail {
  to: string[];
  subject: string;
  html: string;
}

export type SendResult =
  | { sent: true; via: "smtp" | "resend"; to: string[] }
  | { sent: false; reason: string; preview?: { to: string[]; subject: string } }
  | { sent: false; error: string };

const DEFAULT_FROM = "Team Leave Manager <onboarding@resend.dev>";

/**
 * Sends with SMTP (Nodemailer) when SMTP_HOST is set — e.g. an Office 365 mailbox —
 * otherwise with Resend when RESEND_API_KEY is set. With neither, nothing is sent and
 * the result says what would have been sent.
 */
export async function sendEmail(email: OutgoingEmail): Promise<SendResult> {
  const from = process.env.NOTIFY_FROM_EMAIL || process.env.SMTP_USER || DEFAULT_FROM;

  if (process.env.SMTP_HOST) {
    const port = Number(process.env.SMTP_PORT || 587);
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      // 465 = TLS from the start; 587/25 = STARTTLS upgrade.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    try {
      await transport.sendMail({ from, to: email.to, subject: email.subject, html: email.html });
      return { sent: true, via: "smtp", to: email.to };
    } catch (err) {
      return { sent: false, error: `SMTP error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: email.to, subject: email.subject, html: email.html }),
    });
    if (!res.ok) return { sent: false, error: `Resend error: ${await res.text()}` };
    return { sent: true, via: "resend", to: email.to };
  }

  return {
    sent: false,
    reason: "Email is not configured (set SMTP_HOST or RESEND_API_KEY)",
    preview: { to: email.to, subject: email.subject },
  };
}
