import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { api, ApiError, orNull, type Report, type ReportMetrics } from "@/lib/api";
import { requireUser, serverApi } from "@/lib/server-api";
import { inputClass } from "../ui";
import {
  formatDate,
  formatHour,
  formatMinutes,
  formatPercent,
  OUTCOMES,
} from "./format";
import { DailyChart, DownloadCsv, HourChart, Legend } from "./report-charts";

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) || undefined;

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export default async function ReportsPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/admin/reports">) {
  const { tenant: slug } = await params;
  const tenant = await orNull(api.tenant(slug));
  if (!tenant) {
    notFound();
  }
  const search = await searchParams;
  const query = {
    from: first(search.from),
    to: first(search.to),
    branchId: first(search.branch),
  };
  const path = `/${slug}/admin/reports`;
  await requireUser(slug, path, ["admin"]);

  // A bad range or unknown branch shows its message above the filters.
  let report: Report | null = null;
  let error: string | null = null;
  try {
    report = await (await serverApi()).admin.report(slug, query);
  } catch (e) {
    if (!(e instanceof ApiError) || ![400, 404].includes(e.status)) {
      throw e;
    }
    error = e.message;
  }

  // "Today" in the tenant's timezone, as the API counts it.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: tenant.timezone,
  }).format(new Date());
  const presets = [
    { label: "Hari ini", from: today, to: today },
    { label: "7 hari", from: addDays(today, -6), to: today },
    { label: "30 hari", from: addDays(today, -29), to: today },
    { label: "Bulan ini", from: `${today.slice(0, 8)}01`, to: today },
  ];
  const presetHref = (from: string, to: string) => {
    const qs = new URLSearchParams({ from, to });
    if (query.branchId) qs.set("branch", query.branchId);
    return `${path}?${qs}`;
  };
  const from = report?.from ?? query.from ?? "";
  const to = report?.to ?? query.to ?? "";

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Laporan</h2>
          <p className="mt-1 text-sm text-slate-500">
            {report
              ? `${formatDate(report.from, { day: "numeric", month: "long", year: "numeric" })} – ${formatDate(report.to, { day: "numeric", month: "long", year: "numeric" })} · ${report.branch?.name ?? "Semua cabang"} · ${report.timezone}`
              : "Pilih rentang tanggal"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => {
            const active = p.from === from && p.to === to;
            return (
              <Link
                key={p.label}
                href={presetHref(p.from, p.to)}
                aria-current={active ? "true" : undefined}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  active
                    ? "bg-blue-600 text-white"
                    : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {p.label}
              </Link>
            );
          })}
        </div>
      </section>

      {/* Keyed by the range so the inputs show it after each navigation. */}
      <Form
        key={`${from}|${to}|${query.branchId ?? ""}`}
        action={path}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <label className="text-sm text-slate-600">
          Dari
          <input
            type="date"
            name="from"
            defaultValue={from}
            max={today}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-sm text-slate-600">
          Sampai
          <input
            type="date"
            name="to"
            defaultValue={to}
            max={today}
            className={`${inputClass} mt-1`}
          />
        </label>
        {tenant.branches.length > 1 && (
          <label className="text-sm text-slate-600">
            Cabang
            <select
              name="branch"
              defaultValue={query.branchId ?? ""}
              className={`${inputClass} mt-1`}
            >
              <option value="">Semua cabang</option>
              {tenant.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Tampilkan
        </button>
        {report && (
          <div className="ml-auto">
            <DownloadCsv report={report} slug={slug} />
          </div>
        )}
      </Form>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {report && <ReportBody report={report} />}
    </div>
  );
}

function ReportBody({ report }: { report: Report }) {
  const { summary } = report;
  const peak = report.byHour.reduce(
    (best, h) => (h.total > best.total ? h : best),
    report.byHour[0],
  );
  const busiestDay = report.daily.reduce(
    (best, d) => (d.total > best.total ? d : best),
    report.daily[0],
  );
  const tiles = [
    { label: "Total tiket", value: String(summary.total) },
    {
      label: "Selesai",
      value: String(summary.completed),
      note: formatPercent(summary.completed, summary.total),
    },
    {
      label: "Dilewati",
      value: String(summary.skipped),
      note: formatPercent(summary.skipped, summary.total),
    },
    {
      label: "Tidak selesai",
      value: String(summary.unfinished),
      note: "Belum dipanggil atau dilayani",
    },
    { label: "Rata-rata tunggu", value: formatMinutes(summary.avgWaitMinutes) },
    {
      label: "Rata-rata layanan",
      value: formatMinutes(summary.avgServiceMinutes),
    },
  ];

  if (summary.total === 0) {
    return (
      <>
        <Tiles tiles={tiles} />
        <p className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          Belum ada tiket pada rentang ini.
        </p>
      </>
    );
  }

  return (
    <>
      <Tiles tiles={tiles} />

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel
          className="lg:col-span-3"
          title="Tiket per hari"
          description={`Tersibuk: ${formatDate(busiestDay.date, { weekday: "long", day: "numeric", month: "short" })} (${busiestDay.total} tiket)`}
          aside={<Legend />}
        >
          <DailyChart daily={report.daily} />
        </Panel>
        <Panel
          className="lg:col-span-2"
          title="Jam kedatangan"
          description={`Jam tersibuk: ${formatHour(peak.hour)}–${formatHour(peak.hour + 1)} · zona ${report.timezone}`}
        >
          <HourChart byHour={report.byHour} />
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Per layanan">
          <MetricsTable
            nameHeader="Layanan"
            rows={report.byService.map((s) => ({
              ...s,
              key: s.serviceId,
              name: `${s.ticketPrefix} · ${s.name}`,
            }))}
          />
        </Panel>
        <Panel
          title="Per loket"
          description="Tiket yang dipanggil oleh loket tersebut"
        >
          <MetricsTable
            nameHeader="Loket"
            rows={report.byCounter.map((c) => ({ key: c.counterId, ...c }))}
          />
        </Panel>
      </div>

      <Panel title="Rincian harian">
        <MetricsTable
          nameHeader="Tanggal"
          rows={report.daily.map((d) => ({
            ...d,
            key: d.date,
            name: formatDate(d.date, {
              weekday: "short",
              day: "numeric",
              month: "short",
              year: "numeric",
            }),
          }))}
          total={summary}
        />
      </Panel>
    </>
  );
}

function Tiles({
  tiles,
}: {
  tiles: { label: string; value: string; note?: string }[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <p className="text-sm text-slate-500">{tile.label}</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
            {tile.value}
          </p>
          {tile.note && (
            <p className="mt-1 text-xs text-slate-500">{tile.note}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function Panel({
  title,
  description,
  aside,
  className = "",
  children,
}: {
  title: string;
  description?: string;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`min-w-0 rounded-xl border border-slate-200 bg-white p-6 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">{title}</h3>
          {description && (
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          )}
        </div>
        {aside}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function MetricsTable({
  nameHeader,
  rows,
  total,
}: {
  nameHeader: string;
  rows: (ReportMetrics & { key: string; name: string })[];
  total?: ReportMetrics;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">Belum ada data.</p>;
  }
  const cells = (row: ReportMetrics) => [
    row.total,
    ...OUTCOMES.map((o) => row[o.key]),
    formatMinutes(row.avgWaitMinutes),
    formatMinutes(row.avgServiceMinutes),
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[30rem] whitespace-nowrap text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="py-2 pr-3 font-medium">{nameHeader}</th>
            <th className="py-2 pr-3 text-right font-medium">Total</th>
            {OUTCOMES.map((o) => (
              <th key={o.key} className="py-2 pr-3 text-right font-medium">
                {o.label}
              </th>
            ))}
            <th className="py-2 pr-3 text-right font-medium">Tunggu</th>
            <th className="py-2 text-right font-medium">Layanan</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-slate-100">
              <td className="py-2 pr-3 text-slate-900">{row.name}</td>
              {cells(row).map((value, i, all) => (
                <td
                  key={i}
                  className={`py-2 text-right tabular-nums text-slate-700 ${
                    i < all.length - 1 ? "pr-3" : ""
                  }`}
                >
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {total && (
          <tfoot>
            <tr className="font-semibold text-slate-900">
              <td className="py-2 pr-3">Total</td>
              {cells(total).map((value, i, all) => (
                <td
                  key={i}
                  className={`py-2 text-right tabular-nums ${
                    i < all.length - 1 ? "pr-3" : ""
                  }`}
                >
                  {value}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
