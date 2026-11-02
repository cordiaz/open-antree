import Link from "next/link";
import { notFound } from "next/navigation";
import { api, orNull } from "@/lib/api";
import { requireUser, serverApi } from "@/lib/server-api";
import { AdminDashboard } from "./admin-dashboard";

export default async function AdminPage({
  params,
}: PageProps<"/[tenant]/admin">) {
  const { tenant: slug } = await params;
  const tenant = await orNull(api.tenant(slug));
  if (!tenant) {
    notFound();
  }
  await requireUser(slug, `/${slug}/admin`, ["admin"]);
  const stats = await (await serverApi()).stats(slug);
  const branch = tenant.branches.find((b) => b.id === stats.branch.id);

  const actions = [
    { href: `/${slug}/admin/services`, label: "Kelola Layanan" },
    { href: `/${slug}/admin/counters`, label: "Kelola Loket" },
    { href: `/${slug}/admin/users`, label: "Kelola Akun Staf" },
    { href: `/${slug}/admin/reports`, label: "Laporan" },
  ];

  return (
    <>
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
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {actions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="rounded-lg border border-slate-300 px-4 py-3 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {action.label}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
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
