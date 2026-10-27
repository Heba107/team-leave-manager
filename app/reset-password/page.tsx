"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card, Field, inputClass } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";

type Stage = "checking" | "ready" | "saving" | "done" | "invalid";

/**
 * Landing page for password-reset links. Accepts:
 *  - ?token_hash=…&type=recovery  (links sent by /api/password-reset; work in any browser)
 *  - ?code=…                      (links sent by Supabase itself; exchanged automatically,
 *                                  only in the browser where the reset was requested)
 * Then lets the person choose a new password.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("checking");
  const [problem, setProblem] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const sb = getSupabase();
      const params = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const linkError = params.get("error_description") ?? hash.get("error_description");
      const tokenHash = params.get("token_hash");
      let failure = linkError ? linkError.replace(/\+/g, " ") : "";

      if (!failure && tokenHash) {
        const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
        if (error) failure = error.message;
      }
      // For ?code= links the client has already exchanged the code while starting up.
      const { data } = await sb.auth.getSession();
      if (!live) return;
      // Remove the one-time token from the address bar.
      window.history.replaceState(null, "", "/reset-password");
      if (data.session && !failure) {
        setStage("ready");
      } else {
        setProblem(
          failure && !/expired|invalid/i.test(failure)
            ? failure
            : "This reset link is invalid or has expired. Links work once and for 1 hour.",
        );
        setStage("invalid");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8 || password.length > 72) return setError("Password must be 8–72 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setStage("saving");
    const { error } = await getSupabase().auth.updateUser({ password });
    if (error) {
      console.error("reset-password: updateUser failed", error);
      setError(
        /different from the old/i.test(error.message) ? "Choose a password that's different from your old one." : error.message,
      );
      setStage("ready");
      return;
    }
    setStage("done");
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">TL</div>
          <h1 className="text-xl font-semibold text-zinc-900">Choose a new password</h1>
        </div>
        <Card className="p-6">
          {stage === "checking" && <p className="text-sm text-zinc-500">Checking your reset link…</p>}
          {stage === "invalid" && (
            <div className="space-y-4 text-sm">
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-rose-800">{problem}</p>
              <p className="text-zinc-600">Go back to the sign-in page and use “Forgot password?” to get a new link.</p>
              <Button className="w-full" onClick={() => router.push("/")}>
                Back to sign in
              </Button>
            </div>
          )}
          {(stage === "ready" || stage === "saving") && (
            <form onSubmit={save} className="space-y-4" noValidate>
              <Field label="New password">
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="Repeat new password">
                <input className={inputClass} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </Field>
              {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
              <Button type="submit" className="w-full" disabled={stage === "saving"}>
                {stage === "saving" ? "Saving…" : "Save new password"}
              </Button>
            </form>
          )}
          {stage === "done" && (
            <div className="space-y-4 text-sm">
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">Your password has been changed. You&apos;re signed in.</p>
              <Button className="w-full" onClick={() => router.push("/")}>
                Continue to the app
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
