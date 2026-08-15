export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-20">
        <div className="max-w-3xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-blue-600">
            Open Source Multi-Tenant Queue Management
          </p>

          <h1 className="text-5xl font-bold tracking-tight text-slate-900 md:text-6xl">
            Kelola antrian bisnis Anda dengan lebih sederhana.
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            Open Antree adalah platform pengantrian berbasis web untuk salon,
            klinik, barber, konsultan, dan berbagai bisnis yang membutuhkan
            sistem antrian digital.
          </p>

          <div className="mt-8 flex flex-wrap gap-4">
            <a
              href="/salon-mawar/queue"
              className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700"
            >
              Coba Demo
            </a>

            <a
              href="/operator"
              className="rounded-lg border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Operator
            </a>

            <a
              href="/admin"
              className="rounded-lg border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Admin
            </a>
          </div>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          <Feature
            title="Multi-Tenant"
            description="Satu platform untuk banyak bisnis dan cabang."
          />

          <Feature
            title="Responsive Web"
            description="Customer dan operator cukup menggunakan browser."
          />

          <Feature
            title="WhatsApp Notification"
            description="Siapkan notifikasi pelanggan melalui WhatsApp."
          />
        </div>
      </section>
    </main>
  );
}

function Feature({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
    </div>
  );
}
