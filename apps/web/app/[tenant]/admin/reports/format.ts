import type { Report, ReportMetrics } from "@/lib/api";

// Series colours for ticket outcomes, in the validated categorical order
// (blue, orange, aqua). Every chart using them also has a legend and a table.
export const OUTCOMES = [
  { key: "completed", label: "Selesai", color: "#2a78d6" },
  { key: "skipped", label: "Dilewati", color: "#eb6834" },
  { key: "unfinished", label: "Tidak selesai", color: "#1baf7a" },
] as const;

export const formatMinutes = (value: number | null) =>
  value === null ? "—" : `${value.toLocaleString("id-ID")} mnt`;

export const formatPercent = (part: number, total: number) =>
  total === 0
    ? "—"
    : `${Math.round((part / total) * 100).toLocaleString("id-ID")}%`;

// Dates are calendar dates (YYYY-MM-DD) with no time; format them in UTC so
// the viewer's timezone can't shift the day.
export function formatDate(
  date: string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
) {
  return new Intl.DateTimeFormat("id-ID", { ...options, timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`));
}

export const formatHour = (hour: number) =>
  `${String(hour).padStart(2, "0")}.00`;

// Axis with four equal, round, whole-number steps reaching at least `value`.
export function niceScale(value: number) {
  const rough = Math.max(value, 4) / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
      .map((m) => m * power)
      .find((s) => s >= rough && Number.isInteger(s)) ?? 10 * power;
  return { max: step * 4, ticks: [4, 3, 2, 1, 0].map((i) => i * step) };
}

const CSV_COLUMNS: [string, (row: ReportMetrics) => string | number][] = [
  ["Total tiket", (r) => r.total],
  ["Selesai", (r) => r.completed],
  ["Dilewati", (r) => r.skipped],
  ["Tidak selesai", (r) => r.unfinished],
  ["Rata-rata tunggu (menit)", (r) => r.avgWaitMinutes ?? ""],
  ["Rata-rata layanan (menit)", (r) => r.avgServiceMinutes ?? ""],
];

// The daily table as CSV, one row per day plus a total row.
export function reportCsv(report: Report) {
  const rows = [
    ["Tanggal", ...CSV_COLUMNS.map(([label]) => label)],
    ...report.daily.map((day) => [
      day.date,
      ...CSV_COLUMNS.map(([, value]) => value(day)),
    ]),
    ["Total", ...CSV_COLUMNS.map(([, value]) => value(report.summary))],
  ];
  return rows.map((row) => row.join(",")).join("\n") + "\n";
}
