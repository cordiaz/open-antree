"use client";

import { useState } from "react";
import { api, type ManagedCounter } from "@/lib/api";
import { redirectToLoginIfUnauthorized } from "@/lib/session-client";
import { ActiveBadge, Button, Card, errorMessage, inputClass } from "../ui";

type Branch = { id: string; name: string };

export function CountersManager({
  slug,
  branches,
  initialCounters,
}: {
  slug: string;
  branches: Branch[];
  initialCounters: ManagedCounter[];
}) {
  const [counters, setCounters] = useState(initialCounters);
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const counter = await api.admin.createCounter(slug, { branchId, name });
      setCounters((list) =>
        [...list, counter].sort((x, y) => x.name.localeCompare(y.name)),
      );
      setName("");
    } catch (e) {
      if (!redirectToLoginIfUnauthorized(e)) setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card title="Tambah loket">
        <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row">
          {branches.length > 1 && (
            <select
              aria-label="Cabang"
              className={inputClass}
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <input
            aria-label="Nama loket"
            placeholder="Nama loket, misalnya Counter 04"
            required
            maxLength={50}
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" variant="primary" disabled={busy}>
            Tambah
          </Button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </Card>

      <Card
        title={`Loket (${counters.length})`}
        description="Loket nonaktif tidak muncul di pilihan operator. Loket yang sedang melayani tiket tidak bisa dinonaktifkan."
      >
        {counters.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada loket.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {counters.map((counter) => (
              <CounterRow
                key={counter.id}
                slug={slug}
                counter={counter}
                branchName={
                  branches.length > 1
                    ? branches.find((b) => b.id === counter.branchId)?.name
                    : undefined
                }
                onSaved={(updated) =>
                  setCounters((list) =>
                    list.map((c) => (c.id === updated.id ? updated : c)),
                  )
                }
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function CounterRow({
  slug,
  counter,
  branchName,
  onSaved,
}: {
  slug: string;
  counter: ManagedCounter;
  branchName?: string;
  onSaved: (counter: ManagedCounter) => void;
}) {
  const [name, setName] = useState(counter.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(body: { name?: string; isActive?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.admin.updateCounter(slug, counter.id, body);
      onSaved(updated);
      setName(updated.name);
    } catch (e) {
      if (!redirectToLoginIfUnauthorized(e)) setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="py-4">
      <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <input
          aria-label={`Nama loket ${counter.name}`}
          maxLength={50}
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <ActiveBadge active={counter.isActive} />
        <Button
          variant="primary"
          disabled={name.trim() === counter.name || busy}
          onClick={() => save({ name: name.trim() })}
        >
          Simpan
        </Button>
        <Button
          disabled={busy}
          onClick={() => save({ isActive: !counter.isActive })}
        >
          {counter.isActive ? "Nonaktifkan" : "Aktifkan"}
        </Button>
      </div>
      {branchName && (
        <p className="mt-1 text-xs text-slate-500">Cabang: {branchName}</p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
