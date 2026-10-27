"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useStore } from "@/lib/store";
import { LoginScreen, UnlinkedScreen } from "./AuthScreens";
import { Nav } from "./Nav";
import { Card, Loading, SyncNotice, Toaster } from "./ui";

/** Pages only admins (team leads) can open. The database enforces the same rules. */
const ADMIN_ONLY = ["/employees", "/reports", "/settings"];

export function AppShell({ children }: { children: ReactNode }) {
  const { status, session, data } = useStore();
  const pathname = usePathname();

  // The password-reset page stands alone: it must work while signed out and before any data loads.
  if (pathname.startsWith("/reset-password")) return <>{children}</>;

  if (status === "signed-out") return <LoginScreen />;
  if (status === "unlinked") return <UnlinkedScreen email={session?.user.email ?? ""} />;

  const adminOnly = ADMIN_ONLY.some((p) => pathname.startsWith(p));
  const blocked = data && adminOnly && data.me.role !== "admin";

  return (
    <>
      <Nav />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <SyncNotice />
        {status !== "ready" ? (
          <Loading />
        ) : blocked ? (
          <Card className="mx-auto mt-10 max-w-md p-6 text-sm text-zinc-600">
            <h1 className="text-lg font-semibold text-zinc-900">Admins only</h1>
            <p className="mt-1">This page is available to team leads. You can submit requests and see your balance on the Dashboard.</p>
          </Card>
        ) : (
          children
        )}
      </main>
      <Toaster />
    </>
  );
}
