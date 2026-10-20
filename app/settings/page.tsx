"use client";

import { useRef, useState } from "react";
import { Button, Card, cx, Loading, Modal, PageHeader } from "@/components/ui";
import { todayISO, WEEKDAY_NAMES } from "@/lib/dates";
import { actions, LEGACY_STORAGE_KEY, readLegacyLocalData, reload, useAppData } from "@/lib/store";
import type { AppData } from "@/lib/types";

type Pending = { kind: "clear" } | { kind: "replace"; data: AppData; source: string };

export default function SettingsPage() {
  const data = useAppData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (!data) return <Loading />;
  const { weekendDays } = data.settings;
  const isEmpty = data.employees.length === 0 && data.leaves.length === 0;
  const legacy = typeof window === "undefined" ? null : readLegacyLocalData();

  function toggleDay(day: number) {
    const next = weekendDays.includes(day) ? weekendDays.filter((d) => d !== day) : [...weekendDays, day].sort();
    actions.updateSettings({ weekendDays: next });
  }

  function backup() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `team-leave-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function pickBackup(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as AppData;
      if (!Array.isArray(parsed.employees) || !Array.isArray(parsed.leaves)) throw new Error("bad shape");
      setConfirm({ kind: "replace", data: parsed, source: `the backup file "${file.name}"` });
    } catch {
      setMessage("That file is not a valid backup.");
    }
  }

  async function confirmAction() {
    if (!confirm) return;
    setBusy(true);
    const ok = confirm.kind === "clear" ? await actions.clearAll() : await actions.importData(confirm.data);
    setBusy(false);
    setConfirm(null);
    if (!ok) return setMessage("");
    if (confirm.kind === "clear") setMessage("All members and leave records were deleted.");
    else {
      setMessage(`Imported ${confirm.data.employees.length} members and ${confirm.data.leaves.length} leave records from ${confirm.source}.`);
      if (confirm.source === "this browser's local storage") window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  }

  async function loadSample() {
    setBusy(true);
    const ok = await actions.loadDemo();
    setBusy(false);
    setMessage(ok ? "Sample team loaded." : "");
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" description="Leave-day rules and data management." />

      <Card className="mb-6 p-5">
        <h2 className="font-semibold">Weekend days</h2>
        <p className="mt-1 text-sm text-zinc-500">
          These days are skipped when calculating leave duration and statistics. A Sunday–Thursday week uses Friday + Saturday.
          Shared by everyone using this database.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {WEEKDAY_NAMES.map((name, i) => (
            <button
              key={name}
              onClick={() => toggleDay(i)}
              className={cx(
                "rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset",
                weekendDays.includes(i) ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-zinc-700 ring-zinc-300 hover:bg-zinc-50",
              )}
            >
              {name}
            </button>
          ))}
        </div>
      </Card>

      {legacy && (legacy.employees.length > 0 || legacy.leaves.length > 0) && (
        <Card className="mb-6 border-indigo-200 bg-indigo-50 p-5">
          <h2 className="font-semibold text-indigo-950">Local data found in this browser</h2>
          <p className="mt-1 text-sm text-indigo-900">
            The previous version of the app saved {legacy.employees.length} members and {legacy.leaves.length} leave records in
            this browser. You can copy them into Supabase.
          </p>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => setConfirm({ kind: "replace", data: legacy, source: "this browser's local storage" })}>
              Import into Supabase
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                window.localStorage.removeItem(LEGACY_STORAGE_KEY);
                setMessage("Local browser data discarded.");
              }}
            >
              Discard local data
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="font-semibold">Data</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Data is stored in Supabase ({data.employees.length} members, {data.leaves.length} leave records) and shared by everyone
          using the app.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => reload()}>
            Refresh from server
          </Button>
          <Button variant="secondary" onClick={backup}>
            Download backup (JSON)
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            Restore from backup
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickBackup(f);
              e.target.value = "";
            }}
          />
          {isEmpty && (
            <Button variant="secondary" onClick={loadSample} disabled={busy}>
              Load sample data
            </Button>
          )}
          <Button variant="danger" onClick={() => setConfirm({ kind: "clear" })} disabled={isEmpty}>
            Delete all data
          </Button>
        </div>
        {message && <p className="mt-3 text-sm text-zinc-600">{message}</p>}
      </Card>

      <Modal
        open={confirm !== null}
        title={confirm?.kind === "clear" ? "Delete all data?" : "Replace all data?"}
        onClose={() => !busy && setConfirm(null)}
      >
        {confirm && (
          <div className="space-y-4 text-sm text-zinc-600">
            <p>
              {confirm.kind === "clear"
                ? "This permanently deletes every team member and leave record from the Supabase database, for everyone. Download a backup first if you want to keep them."
                : `This deletes the ${data.employees.length} members and ${data.leaves.length} leave records currently in Supabase and replaces them with ${confirm.data.employees.length} members and ${confirm.data.leaves.length} leave records from ${confirm.source}.`}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmAction} disabled={busy}>
                {busy ? "Working…" : confirm.kind === "clear" ? "Delete everything" : "Replace data"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
