import type { TicketStatus } from "./api";

export const statusLabel: Record<TicketStatus, string> = {
  waiting: "Menunggu",
  called: "Dipanggil",
  serving: "Sedang dilayani",
  completed: "Selesai",
  skipped: "Dilewati",
  cancelled: "Dibatalkan",
};

export const formatMinutes = (minutes: number) =>
  minutes === 0 ? "Sekarang" : `± ${minutes} menit`;
