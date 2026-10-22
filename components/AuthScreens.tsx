"use client";

import { useState } from "react";
import { actions } from "@/lib/store";
import { Button, Card, Field, inputClass } from "./ui";

type Mode = "signin" | "signup" | "reset";

/**
 * Creates an already-confirmed account through our /api/signup route (Supabase admin API,
 * so no confirmation email and no email rate limit), then signs in with the same password.
 * Returns an error message, or null once the user is signed in.
 */
async function signUp(name: string, email: string, password: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
  } catch {
    return "Can't reach the server. Check your connection and try again.";
  }
  const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
  if (!res.ok) {
    if (body.code === "not_configured")
      return "Sign-up is temporarily unavailable (the server is missing its Supabase key). Please contact your team lead.";
    return body.error ?? "Couldn't create the account. Please try again.";
  }
  // Signing in fires the auth listener in lib/store, which loads the app.
  const err = await actions.signIn(email, password);
  return err ? `Your account was created, but signing in failed: ${err}. Try signing in.` : null;
}

export function LoginScreen() {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    const addr = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(addr)) return setError("Enter a valid email address.");
    if (mode !== "reset" && password.length < 8) return setError("Password must be at least 8 characters.");
    if (mode === "signup" && !name.trim()) return setError("Enter your name.");
    setBusy(true);
    if (mode === "signin") {
      const err = await actions.signIn(addr, password);
      if (err) setError(err === "Invalid login credentials" ? "Wrong email or password." : err);
    } else if (mode === "signup") {
      const err = await signUp(name.trim(), addr, password);
      if (err) setError(err);
    } else {
      const err = await actions.sendPasswordReset(addr);
      if (err) setError(err);
      else setInfo("If an account exists for that email, a password reset link is on its way.");
    }
    setBusy(false);
  }

  const switchTo = (m: Mode) => {
    setMode(m);
    setError("");
    setInfo("");
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">TL</div>
          <h1 className="text-xl font-semibold text-zinc-900">
            {mode === "signin" ? "Sign in to Team Leave" : mode === "signup" ? "Create your account" : "Reset your password"}
          </h1>
          {mode === "signup" && (
            <p className="text-sm text-zinc-500">Use your @aman.eg work email. You&apos;ll get access as an employee right away.</p>
          )}
        </div>
        <Card className="p-6">
          <form onSubmit={submit} className="space-y-4" noValidate>
            {mode === "signup" && (
              <Field label="Full name">
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </Field>
            )}
            <Field label="Work email">
              <input
                className={inputClass}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
              />
            </Field>
            {mode !== "reset" && (
              <Field label="Password">
                <input
                  className={inputClass}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                />
              </Field>
            )}
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
            {info && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{info}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
            </Button>
          </form>
        </Card>
        <div className="mt-4 flex justify-center gap-4 text-sm">
          {mode !== "signin" && (
            <button className="font-medium text-indigo-600 hover:underline" onClick={() => switchTo("signin")}>
              Back to sign in
            </button>
          )}
          {mode === "signin" && (
            <>
              <button className="font-medium text-indigo-600 hover:underline" onClick={() => switchTo("signup")}>
                Create an account
              </button>
              <button className="text-zinc-500 hover:underline" onClick={() => switchTo("reset")}>
                Forgot password?
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function UnlinkedScreen({ email }: { email: string }) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center px-4">
      <Card className="max-w-md p-6 text-sm text-zinc-600">
        <h1 className="text-lg font-semibold text-zinc-900">Your access is turned off</h1>
        <p className="mt-2">
          You&apos;re signed in as <strong className="text-zinc-900">{email}</strong>, but your team member profile has been
          deactivated. Ask your team lead to reactivate it on the Employees page, then reload.
        </p>
        <div className="mt-5 flex gap-2">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="secondary" onClick={() => actions.signOut()}>
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}
