"use client";

import { useCallback, useState } from "react";
import { api, type CounterConsole } from "@/lib/api";
import { statusLabel } from "@/lib/labels";
import { usePolling } from "@/lib/use-polling";

const POLL_MS = 3000;

export function OperatorConsole({
  slug,
  initialConsole,
}: {
  slug: string;
  initialConsole: CounterConsole;
}) {
  const counterId = initialConsole.counter.id;
  const fetchConsole = useCallback(
    () => api.counter(slug, counterId),
    [slug, counterId],
  );
  const { data, error: pollError, refresh } = usePolling(
    fetchConsole,
    POLL_MS,
    initialConsole,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Aksi gagal");
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  const callNext = () =>
    run(async () => {
      const { ticket } = await api.callNext(slug, counterId);
      if (!ticket) {
        setMessage("Tidak ada antrian yang menunggu.");
      }
    });

  const current = data.current;
  const transition = (action: "start" | "complete" | "skip") =>
    current && run(() => api.transition(slug, current.id, action));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="rounded-2xl bg-white p-8 shadow-sm lg:col-span-2">
        <p className="text-center text-sm font-medium uppercase tracking-wider text-slate-500">
          {current ? statusLabel[current.status] : "Tidak ada yang dilayani"}
        </p>
        <p className="mt-4 text-center text-8xl font-bold text-slate-900">
          {current?.code ?? "—"}
        </p>
        <p className="mt-4 text-center text-slate-500">
          {current?.service.name ?? " "}
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {!current && (
            <ActionButton primary onClick={callNext} disabled={busy}>
              Panggil Berikutnya
            </ActionButton>
          )}
          {current?.status === "called" && (
            <>
              <ActionButton
                primary
                onClick={() => transition("start")}
                disabled={busy}
              >
                Mulai Layani
              </ActionButton>
              <ActionButton onClick={() => transition("skip")} disabled={busy}>
                Lewati (tidak hadir)
              </ActionButton>
            </>
          )}
          {current && (
            <ActionButton
              primary={current.status === "serving"}
              onClick={() => transition("complete")}
              disabled={busy}
            >
              Selesaikan
            </ActionButton>
          )}
        </div>

        {(message ?? pollError) && (
          <p className="mt-4 text-center text-sm text-red-600">
            {message ?? pollError}
          </p>
        )}
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          Waiting Queue ({data.waiting.length})
        </h2>
        <div className="mt-5 space-y-3">
          {data.waiting.length === 0 && (
            <p className="text-sm text-slate-500">Antrian kosong.</p>
          )}
          {data.waiting.map((ticket) => (
            <div
              key={ticket.id}
              className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3"
            >
              <span className="font-semibold text-slate-900">
                {ticket.code}
              </span>
              <span className="text-sm text-slate-500">{ticket.service}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ActionButton({
  primary,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      type="button"
      className={
        primary
          ? "rounded-lg bg-blue-600 px-5 py-4 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          : "rounded-lg border border-slate-300 px-5 py-4 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      }
      {...props}
    />
  );
}
