"use client";

import { useCallback } from "react";
import { api, type BranchStats } from "@/lib/api";
import { useLiveData } from "@/lib/use-queue-events";
import { LiveIndicator } from "../live-indicator";

export function AdminDashboard({
  slug,
  initialStats,
}: {
  slug: string;
  initialStats: BranchStats;
}) {
  const fetchStats = useCallback(() => api.stats(slug), [slug]);
  const {
    data: stats,
    error,
    connected,
  } = useLiveData(slug, fetchStats, initialStats);

  const tiles = [
    { label: "Waiting", value: String(stats.tickets.waiting) },
    { label: "Serving", value: String(stats.tickets.serving) },
    { label: "Completed", value: String(stats.tickets.completed) },
    {
      label: "Average Wait",
      value:
        stats.averageWaitMinutes === null
          ? "—"
          : `${stats.averageWaitMinutes} min`,
    },
  ];

  return (
    <>
      <p className="mb-4 text-sm text-slate-500">
        Hari ini ({stats.serviceDate}) · {stats.branch.name}
        {error && <span className="ml-2 text-red-600">· {error}</span>}
        <span className="ml-3">
          <LiveIndicator connected={connected} />
        </span>
      </p>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <p className="text-sm text-slate-500">{tile.label}</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              {tile.value}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-slate-500">
        Notifikasi WhatsApp hari ini:{" "}
        {stats.notifications ? (
          <>
            {stats.notifications.sent} terkirim
            {stats.notifications.pending > 0 &&
              ` · ${stats.notifications.pending} dalam antrean kirim`}
            {stats.notifications.failed > 0 && (
              <span className="text-red-600">
                {" "}
                · {stats.notifications.failed} gagal
              </span>
            )}
          </>
        ) : (
          "nonaktif"
        )}
      </p>
    </>
  );
}
