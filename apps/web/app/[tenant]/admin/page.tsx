import { notFound } from "next/navigation";
import { api, orNull } from "@/lib/api";
import { AdminDashboard } from "./admin-dashboard";

export default async function AdminPage({
  params,
}: PageProps<"/[tenant]/admin">) {
  const { tenant: slug } = await params;
  const [tenant, stats] = await Promise.all([
    orNull(api.tenant(slug)),
    orNull(api.stats(slug)),
  ]);
  if (!tenant || !stats) {
    notFound();
  }
  const branch = tenant.branches.find((b) => b.id === stats.branch.id);

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-5">
          <p className="text-sm font-semibold text-blue-600">OPEN ANTREE</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            Tenant Dashboard
          </h1>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <AdminDashboard slug={slug} initialStats={stats} />

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Business</h2>
            <dl className="mt-5 space-y-4 text-sm">
              <Row label="Tenant" value={tenant.name} />
              <Row label="Branch" value={stats.branch.name} />
              <Row label="Counters" value={String(stats.counters)} />
              <Row
                label="Services"
                value={
                  branch?.services
                    .map((s) => `${s.ticketPrefix} · ${s.name}`)
                    .join(", ") || "—"
                }
              />
              <Row label="Timezone" value={tenant.timezone} />
            </dl>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">
              Quick Actions
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Pengelolaan data akan tersedia di tahap berikutnya.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                "Manage Services",
                "Manage Counters",
                "Manage Operators",
                "Reports",
              ].map((label) => (
                <button
                  key={label}
                  type="button"
                  disabled
                  className="cursor-not-allowed rounded-lg border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-400"
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
