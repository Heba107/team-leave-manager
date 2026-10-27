"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { STATUS_STYLES, TYPE_STYLES } from "@/lib/leave";
import { actions, reload, useStore } from "@/lib/store";
import type { LeaveStatus, LeaveType } from "@/lib/types";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm",
  secondary: "bg-white text-zinc-700 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-50 shadow-sm",
  danger: "bg-rose-600 text-white hover:bg-rose-500 shadow-sm",
  ghost: "text-zinc-600 hover:bg-zinc-100",
};

export function buttonClass(variant: ButtonVariant = "primary", size: "sm" | "md" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
    BUTTON[variant],
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return <button type="button" {...props} className={cx(buttonClass(variant, size), className)} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-xl border border-zinc-200 bg-white shadow-sm", className)}>{children}</div>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "warning";
}) {
  return (
    <Card className={cx("p-5", tone === "warning" && "border-amber-300 bg-amber-50")}>
      <p className={cx("text-sm font-medium", tone === "warning" ? "text-amber-800" : "text-zinc-500")}>{label}</p>
      <p className={cx("mt-2 text-3xl font-semibold", tone === "warning" ? "text-amber-900" : "text-zinc-900")}>
        {value}
      </p>
      {hint && <p className={cx("mt-1 text-xs", tone === "warning" ? "text-amber-700" : "text-zinc-500")}>{hint}</p>}
    </Card>
  );
}

export function TypeBadge({ type }: { type: LeaveType }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TYPE_STYLES[type].chip)}>
      {type}
    </span>
  );
}

export function StatusBadge({ status }: { status: LeaveStatus }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", STATUS_STYLES[status])}>
      {status}
    </span>
  );
}

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-zinc-700">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  );
}

export const inputClass =
  "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm ring-1 ring-inset ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 outline-none";

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl p-0 shadow-xl backdrop:bg-zinc-900/40"
    >
      {open && (
        <div className="p-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
            <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600" aria-label="Close">
              ✕
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-6 py-12 text-center text-sm text-zinc-500">{children}</div>;
}

export function Loading() {
  const { status, error } = useStore();
  if (status === "error") {
    return (
      <div className="mx-auto mt-10 max-w-xl rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
        <p className="font-semibold">Couldn&apos;t load data from Supabase</p>
        <p className="mt-1">{error}</p>
        <Button className="mt-4" onClick={() => reload()}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-48 rounded bg-zinc-200" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-xl bg-zinc-200" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-zinc-200" />
    </div>
  );
}

/** Banner for failed saves (e.g. overlap rejected by the database, network errors). */
export function SyncNotice() {
  const { notice } = useStore();
  if (!notice) return null;
  return (
    <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
      <span>
        <strong>Not saved:</strong> {notice}
      </span>
      <button onClick={actions.dismissNotice} className="text-rose-500 hover:text-rose-700" aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts: toast.success("Saved") / toast.error("…") from anywhere; <Toaster /> renders them.
// ---------------------------------------------------------------------------

interface ToastItem {
  id: number;
  tone: "success" | "error";
  text: string;
}

let toasts: ToastItem[] = [];
let nextToastId = 1;
const toastListeners = new Set<() => void>();
const NO_TOASTS: ToastItem[] = [];

function setToasts(next: ToastItem[]) {
  toasts = next;
  toastListeners.forEach((l) => l());
}

function dismissToast(id: number) {
  setToasts(toasts.filter((t) => t.id !== id));
}

function showToast(tone: ToastItem["tone"], text: string) {
  const id = nextToastId++;
  setToasts([...toasts, { id, tone, text }]);
  setTimeout(() => dismissToast(id), tone === "error" ? 7000 : 4000);
}

export const toast = {
  success: (text: string) => showToast("success", text),
  error: (text: string) => showToast("error", text),
};

export function Toaster() {
  const items = useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts,
    () => NO_TOASTS,
  );
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:right-6 sm:w-96">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={cx(
            "pointer-events-auto flex w-full items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg",
            t.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900",
          )}
        >
          <span>
            <span aria-hidden className="mr-1.5">
              {t.tone === "success" ? "✓" : "!"}
            </span>
            {t.text}
          </span>
          <button onClick={() => dismissToast(t.id)} className="opacity-60 hover:opacity-100" aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
