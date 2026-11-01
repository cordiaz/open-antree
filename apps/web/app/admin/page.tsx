const statistics = [
  {
    label: "Waiting",
    value: "18",
  },
  {
    label: "Serving",
    value: "3",
  },
  {
    label: "Completed",
    value: "76",
  },
  {
    label: "Average Wait",
    value: "12 min",
  },
];

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-5">
          <p className="text-sm font-semibold text-blue-600">
            OPEN ANTREE
          </p>

          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            Tenant Dashboard
          </h1>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {statistics.map((statistic) => (
            <div
              key={statistic.label}
              className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <p className="text-sm text-slate-500">
                {statistic.label}
              </p>

              <p className="mt-2 text-3xl font-bold text-slate-900">
                {statistic.value}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">
              Business
            </h2>

            <dl className="mt-5 space-y-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Tenant</dt>
                <dd className="font-medium">Salon Mawar</dd>
              </div>

              <div className="flex justify-between">
                <dt className="text-slate-500">Branch</dt>
                <dd className="font-medium">Jakarta</dd>
              </div>

              <div className="flex justify-between">
                <dt className="text-slate-500">Counters</dt>
                <dd className="font-medium">3</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">
              Quick Actions
            </h2>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold hover:bg-slate-50"
              >
                Manage Services
              </button>

              <button
                type="button"
                className="rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold hover:bg-slate-50"
              >
                Manage Counters
              </button>

              <button
                type="button"
                className="rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold hover:bg-slate-50"
              >
                Manage Operators
              </button>

              <button
                type="button"
                className="rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold hover:bg-slate-50"
              >
                Reports
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
