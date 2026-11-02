"use client";

import { useState } from "react";
import type { Report } from "@/lib/api";
import {
  formatDate,
  formatHour,
  formatMinutes,
  niceScale,
  OUTCOMES,
  reportCsv,
} from "./format";

const PLOT_HEIGHT = "h-56";

// Horizontal gridlines with their values, behind the bars.
function Grid({ scale }: { scale: ReturnType<typeof niceScale> }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {scale.ticks.map((tick) => (
        <div
          key={tick}
          className="absolute inset-x-0 border-t border-slate-100"
          style={{ bottom: `${(tick / scale.max) * 100}%` }}
        >
          <span className="absolute -top-2 left-0 -translate-x-full pr-2 text-[11px] tabular-nums text-slate-400">
            {tick}
          </span>
        </div>
      ))}
    </div>
  );
}

function Tooltip({ title, rows }: { title: string; rows: [string, string, string?][] }) {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-slate-900">{title}</p>
      {rows.map(([label, value, color]) => (
        <p key={label} className="mt-1 flex items-center gap-2 text-slate-500">
          {color && (
            <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
          )}
          <span>{label}</span>
          <span className="ml-auto pl-3 font-semibold tabular-nums text-slate-900">
            {value}
          </span>
        </p>
      ))}
    </div>
  );
}

export function Legend() {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-slate-600">
      {OUTCOMES.map((o) => (
        <span key={o.key} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: o.color }} />
          {o.label}
        </span>
      ))}
    </div>
  );
}

// Tickets per day, stacked by outcome.
export function DailyChart({ daily }: { daily: Report["daily"] }) {
  const [active, setActive] = useState<number | null>(null);
  const scale = niceScale(Math.max(...daily.map((d) => d.total)));
  const max = scale.max;
  // Keep date labels readable on long ranges.
  const labelEvery = Math.ceil(daily.length / 8);

  return (
    <div className="pl-8">
      <div className={`relative ${PLOT_HEIGHT}`}>
        <Grid scale={scale} />
        <div className="absolute inset-0 flex">
          {daily.map((day, i) => (
            <div
              key={day.date}
              tabIndex={0}
              aria-label={`${formatDate(day.date)}: ${day.total} tiket`}
              className="relative flex h-full flex-1 flex-col-reverse items-center outline-none"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <div
                className={`flex h-full w-[70%] max-w-12 flex-col-reverse ${
                  active === i ? "opacity-100" : active === null ? "" : "opacity-60"
                }`}
              >
                {OUTCOMES.map((o, k) => {
                  const value = day[o.key];
                  if (!value) return null;
                  const isTop = OUTCOMES.slice(k + 1).every((n) => !day[n.key]);
                  return (
                    <div
                      key={o.key}
                      className={`shrink-0 bg-clip-padding ${
                        k > 0 ? "border-b-2 border-transparent" : ""
                      } ${isTop ? "rounded-t" : ""}`}
                      style={{
                        height: `${(value / max) * 100}%`,
                        backgroundColor: o.color,
                      }}
                    />
                  );
                })}
              </div>
              {active === i && (
                <div
                  className="absolute left-1/2"
                  style={{ bottom: `${(day.total / max) * 100}%` }}
                >
                  <Tooltip
                    title={formatDate(day.date, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                    rows={[
                      ["Total", String(day.total)],
                      ...OUTCOMES.map(
                        (o) =>
                          [o.label, String(day[o.key]), o.color] as [
                            string,
                            string,
                            string,
                          ],
                      ),
                      ["Rata-rata tunggu", formatMinutes(day.avgWaitMinutes)],
                    ]}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex border-t border-slate-200 pt-2">
        {daily.map((day, i) => (
          <span
            key={day.date}
            className="flex flex-1 justify-center whitespace-nowrap text-[11px] text-slate-500"
          >
            {i % labelEvery === 0 ? formatDate(day.date) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

// Tickets taken per hour of day, over the opening hours actually used.
export function HourChart({ byHour }: { byHour: Report["byHour"] }) {
  const [active, setActive] = useState<number | null>(null);
  const used = byHour.filter((h) => h.total > 0).map((h) => h.hour);
  const first = Math.min(8, ...used);
  const last = Math.max(18, ...used);
  const hours = byHour.slice(first, last + 1);
  const scale = niceScale(Math.max(...hours.map((h) => h.total)));
  const max = scale.max;

  return (
    <div className="pl-8">
      <div className={`relative ${PLOT_HEIGHT}`}>
        <Grid scale={scale} />
        <div className="absolute inset-0 flex">
          {hours.map((h) => (
            <div
              key={h.hour}
              tabIndex={0}
              aria-label={`${formatHour(h.hour)}: ${h.total} tiket`}
              className="relative flex h-full flex-1 flex-col-reverse items-center outline-none"
              onMouseEnter={() => setActive(h.hour)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(h.hour)}
              onBlur={() => setActive(null)}
            >
              {h.total > 0 && (
                <div
                  className={`w-[70%] max-w-10 rounded-t ${
                    active === null || active === h.hour ? "" : "opacity-60"
                  }`}
                  style={{
                    height: `${(h.total / max) * 100}%`,
                    background: OUTCOMES[0].color,
                  }}
                />
              )}
              {active === h.hour && (
                <div
                  className="absolute left-1/2"
                  style={{ bottom: `${(h.total / max) * 100}%` }}
                >
                  <Tooltip
                    title={`${formatHour(h.hour)}–${formatHour(h.hour + 1)}`}
                    rows={[["Tiket diambil", String(h.total)]]}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex border-t border-slate-200 pt-2">
        {hours.map((h) => (
          <span
            key={h.hour}
            className="flex-1 text-center text-[11px] tabular-nums text-slate-500"
          >
            {h.hour % 2 === 0 ? String(h.hour).padStart(2, "0") : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DownloadCsv({ report, slug }: { report: Report; slug: string }) {
  const download = () => {
    const blob = new Blob([reportCsv(report)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `laporan-${slug}-${report.from}-${report.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button
      type="button"
      onClick={download}
      className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
    >
      Unduh CSV
    </button>
  );
}
