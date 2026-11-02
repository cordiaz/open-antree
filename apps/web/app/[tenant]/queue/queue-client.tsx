"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type QueueBoard, type Ticket } from "@/lib/api";
import { formatMinutes, statusLabel } from "@/lib/labels";
import { usePolling } from "@/lib/use-polling";
import { FALLBACK_POLL_MS, useQueueEvents } from "@/lib/use-queue-events";
import { LiveIndicator } from "../live-indicator";
const FINISHED: Ticket["status"][] = ["completed", "skipped", "cancelled"];

// The customer's ticket id is kept in localStorage so a refresh keeps it.
const storageKey = (slug: string) => `open-antree:${slug}:ticket`;

function readStoredTicketId(slug: string): string | null {
  try {
    return localStorage.getItem(storageKey(slug));
  } catch {
    return null;
  }
}

function storeTicketId(slug: string, ticketId: string | null) {
  try {
    if (ticketId) {
      localStorage.setItem(storageKey(slug), ticketId);
    } else {
      localStorage.removeItem(storageKey(slug));
    }
  } catch {
    // Storage unavailable (private mode): the ticket just won't survive a refresh.
  }
}

export function QueueClient({
  slug,
  initialQueue,
  whatsapp,
}: {
  slug: string;
  initialQueue: QueueBoard;
  // Offer WhatsApp notifications (the API has a provider configured).
  whatsapp: boolean;
}) {
  const fetchQueue = useCallback(() => api.queue(slug), [slug]);
  const { data: queue, refresh: refreshQueue } = usePolling(
    fetchQueue,
    FALLBACK_POLL_MS,
    initialQueue,
  );
  // Bumped on every live event so the customer's own ticket reloads too.
  const [changeCount, setChangeCount] = useState(0);
  const onQueueChange = useCallback(() => {
    void refreshQueue();
    setChangeCount((n) => n + 1);
  }, [refreshQueue]);
  const connected = useQueueEvents(slug, onQueueChange);

  const [serviceId, setServiceId] = useState(
    initialQueue.services[0]?.id ?? "",
  );
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Restore and keep refreshing the customer's own ticket.
  useEffect(() => {
    const ticketId = ticket?.id ?? readStoredTicketId(slug);
    if (!ticketId) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const latest = await api.ticket(slug, ticketId);
        if (cancelled) return;
        // A ticket from a previous day is no longer meaningful.
        if (latest.serviceDate !== queue.serviceDate) {
          storeTicketId(slug, null);
          setTicket(null);
        } else {
          setTicket(latest);
        }
      } catch (error) {
        // Forget the ticket only if the API says it doesn't exist. A network
        // error (flaky connection, or a request cut off by a page reload) must
        // not make the customer lose their number; the next refresh retries.
        if (!cancelled && error instanceof ApiError && error.status === 404) {
          storeTicketId(slug, null);
          setTicket(null);
        }
      }
    };
    void load();
    const id = setInterval(load, FALLBACK_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [slug, ticket?.id, queue.serviceDate, changeCount]);

  async function takeTicket() {
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.takeTicket(slug, serviceId, {
        customerName: customerName.trim() || undefined,
        customerPhone: (whatsapp && customerPhone.trim()) || undefined,
      });
      storeTicketId(slug, created.id);
      setTicket(created);
      void refreshQueue();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengambil nomor");
    } finally {
      setSubmitting(false);
    }
  }

  function startOver() {
    storeTicketId(slug, null);
    setTicket(null);
  }

  const selected =
    queue.services.find((s) => s.id === (ticket?.service.id ?? serviceId)) ??
    queue.services[0];

  if (queue.services.length === 0) {
    return (
      <p className="mt-8 text-center text-slate-500">
        Belum ada layanan yang tersedia.
      </p>
    );
  }

  return (
    <>
      {ticket ? (
        <TicketCard
          ticket={ticket}
          onStartOver={startOver}
          finished={FINISHED.includes(ticket.status)}
        />
      ) : (
        <div className="mt-8 space-y-4">
          <div>
            <label
              htmlFor="service"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Pilih layanan
            </label>
            <select
              id="service"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-700 outline-none focus:border-blue-500"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
            >
              {queue.services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="name"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Nama (opsional)
            </label>
            <input
              id="name"
              maxLength={100}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-700 outline-none focus:border-blue-500"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </div>

          {whatsapp && (
            <div>
              <label
                htmlFor="phone"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Nomor WhatsApp (opsional)
              </label>
              <input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={24}
                placeholder="0812-3456-7890"
                aria-describedby="phone-help"
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-700 outline-none focus:border-blue-500"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
              <p id="phone-help" className="mt-1.5 text-xs text-slate-500">
                Kami kirim pesan WhatsApp saat giliran Anda sudah dekat dan saat
                nomor Anda dipanggil, jadi Anda tidak perlu menunggu di depan
                loket.
              </p>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="button"
            onClick={takeTicket}
            disabled={submitting || !serviceId}
            className="w-full rounded-lg bg-blue-600 px-6 py-4 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            {submitting ? "Memproses…" : "Ambil Nomor Antrian"}
          </button>
        </div>
      )}

      {selected && (
        <div className="mt-8 border-t border-slate-200 pt-8 text-center">
          <p className="text-sm text-slate-500">
            {selected.name} · nomor yang sedang dilayani
          </p>
          <p className="mt-2 text-5xl font-bold text-slate-900">
            {selected.nowServing.map((t) => t.code).join(" · ") || "—"}
          </p>
          <p className="mt-4 text-sm text-slate-500">
            {selected.waiting} orang menunggu · estimasi waktu tunggu
          </p>
          <p className="mt-1 text-2xl font-semibold text-blue-600">
            {formatMinutes(selected.estimatedWaitMinutes)}
          </p>
          <div className="mt-6">
            <LiveIndicator connected={connected} />
          </div>
        </div>
      )}
    </>
  );
}

function TicketCard({
  ticket,
  finished,
  onStartOver,
}: {
  ticket: Ticket;
  finished: boolean;
  onStartOver: () => void;
}) {
  const called = ticket.status === "called";
  return (
    <div
      className={`mt-8 rounded-xl p-6 text-center ${
        called ? "bg-blue-600 text-white" : "bg-slate-50"
      }`}
    >
      <p className={`text-sm ${called ? "text-blue-100" : "text-slate-500"}`}>
        Nomor antrian Anda · {ticket.service.name}
      </p>
      <p className="mt-2 text-6xl font-bold">{ticket.code}</p>
      <p className="mt-3 font-semibold">
        {called
          ? `Silakan menuju ${ticket.counter}`
          : statusLabel[ticket.status]}
      </p>
      {ticket.status === "waiting" && (
        <p className="mt-1 text-sm text-slate-500">
          {ticket.ahead} orang di depan Anda ·{" "}
          {formatMinutes(ticket.estimatedWaitMinutes)}
        </p>
      )}
      {ticket.whatsapp && !finished && (
        <p
          className={`mt-3 text-xs ${called ? "text-blue-100" : "text-slate-500"}`}
        >
          Notifikasi WhatsApp dikirim ke {ticket.whatsapp}
        </p>
      )}
      {finished && (
        <button
          type="button"
          onClick={onStartOver}
          className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Ambil nomor baru
        </button>
      )}
    </div>
  );
}
