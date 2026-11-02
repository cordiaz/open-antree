"use client";

import { useState } from "react";
import { api, type ManagedService } from "@/lib/api";
import { redirectToLoginIfUnauthorized } from "@/lib/session-client";
import { ActiveBadge, Button, Card, errorMessage, inputClass } from "../ui";

type Branch = { id: string; name: string };

export function ServicesManager({
  slug,
  branches,
  initialServices,
}: {
  slug: string;
  branches: Branch[];
  initialServices: ManagedService[];
}) {
  const [services, setServices] = useState(initialServices);
  const replace = (updated: ManagedService) =>
    setServices((list) => list.map((s) => (s.id === updated.id ? updated : s)));

  return (
    <div className="space-y-6">
      <Card
        title="Tambah layanan"
        description="Prefix dipakai untuk kode tiket, misalnya A → A001, A002."
      >
        <CreateServiceForm
          slug={slug}
          branches={branches}
          onCreated={(service) =>
            setServices((list) =>
              [...list, service].sort((x, y) =>
                x.ticketPrefix.localeCompare(y.ticketPrefix),
              ),
            )
          }
        />
      </Card>

      <Card
        title={`Layanan (${services.length})`}
        description="Layanan nonaktif tidak bisa dipilih pelanggan. Tiket yang sudah diambil tetap bisa dilayani."
      >
        {services.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada layanan.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {services.map((service) => (
              <ServiceRow
                key={service.id}
                slug={slug}
                service={service}
                branchName={
                  branches.length > 1
                    ? branches.find((b) => b.id === service.branchId)?.name
                    : undefined
                }
                onSaved={replace}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function CreateServiceForm({
  slug,
  branches,
  onCreated,
}: {
  slug: string;
  branches: Branch[];
  onCreated: (service: ManagedService) => void;
}) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [minutes, setMinutes] = useState("15");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await api.admin.createService(slug, {
          branchId,
          name,
          ticketPrefix: prefix,
          avgServiceMinutes: Number(minutes),
        }),
      );
      setName("");
      setPrefix("");
      setMinutes("15");
    } catch (e) {
      if (!redirectToLoginIfUnauthorized(e)) setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_7rem_9rem_auto]">
      {branches.length > 1 && (
        <select
          aria-label="Cabang"
          className={`${inputClass} sm:col-span-4`}
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
        aria-label="Nama layanan"
        placeholder="Nama layanan"
        required
        maxLength={100}
        className={inputClass}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        aria-label="Prefix"
        placeholder="Prefix"
        required
        maxLength={4}
        pattern="[A-Z]{1,4}"
        title="1-4 huruf kapital"
        className={inputClass}
        value={prefix}
        onChange={(e) => setPrefix(e.target.value.toUpperCase())}
      />
      <input
        aria-label="Rata-rata menit"
        type="number"
        min={1}
        max={480}
        required
        className={inputClass}
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
      />
      <Button type="submit" variant="primary" disabled={busy}>
        Tambah
      </Button>
      {error && <p className="text-sm text-red-600 sm:col-span-4">{error}</p>}
    </form>
  );
}

function ServiceRow({
  slug,
  service,
  branchName,
  onSaved,
}: {
  slug: string;
  service: ManagedService;
  branchName?: string;
  onSaved: (service: ManagedService) => void;
}) {
  const [name, setName] = useState(service.name);
  const [prefix, setPrefix] = useState(service.ticketPrefix);
  const [minutes, setMinutes] = useState(String(service.avgServiceMinutes));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty =
    name.trim() !== service.name ||
    prefix !== service.ticketPrefix ||
    Number(minutes) !== service.avgServiceMinutes;

  async function save(body: Parameters<typeof api.admin.updateService>[2]) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.admin.updateService(slug, service.id, body);
      onSaved(updated);
      setName(updated.name);
      setPrefix(updated.ticketPrefix);
      setMinutes(String(updated.avgServiceMinutes));
    } catch (e) {
      if (!redirectToLoginIfUnauthorized(e)) setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="py-4">
      <div className="grid items-center gap-3 sm:grid-cols-[1fr_7rem_9rem_auto_auto_auto]">
        <input
          aria-label={`Nama layanan ${service.name}`}
          maxLength={100}
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          aria-label={`Prefix ${service.name}`}
          maxLength={4}
          className={inputClass}
          value={prefix}
          onChange={(e) => setPrefix(e.target.value.toUpperCase())}
        />
        <div className="flex items-center gap-2">
          <input
            aria-label={`Rata-rata menit ${service.name}`}
            type="number"
            min={1}
            max={480}
            className={inputClass}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
          <span className="text-xs text-slate-500">mnt</span>
        </div>
        <ActiveBadge active={service.isActive} />
        <Button
          variant="primary"
          disabled={!dirty || busy}
          onClick={() =>
            save({
              name: name.trim(),
              ticketPrefix: prefix,
              avgServiceMinutes: Number(minutes),
            })
          }
        >
          Simpan
        </Button>
        <Button
          disabled={busy}
          onClick={() => save({ isActive: !service.isActive })}
        >
          {service.isActive ? "Nonaktifkan" : "Aktifkan"}
        </Button>
      </div>
      {branchName && (
        <p className="mt-1 text-xs text-slate-500">Cabang: {branchName}</p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
