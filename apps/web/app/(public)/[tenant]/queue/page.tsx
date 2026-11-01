type QueuePageProps = {
  params: Promise<{
    tenant: string;
  }>;
};

export default async function QueuePage({
  params,
}: QueuePageProps) {
  const { tenant } = await params;

  const tenantName =
    tenant === "salon-mawar"
      ? "Salon Mawar"
      : tenant.replaceAll("-", " ");

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-lg">
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="text-center">
            <p className="text-sm font-medium text-blue-600">
              OPEN ANTREE
            </p>

            <h1 className="mt-2 text-3xl font-bold capitalize text-slate-900">
              {tenantName}
            </h1>

            <p className="mt-2 text-sm text-slate-500">
              Ambil nomor antrian secara online
            </p>
          </div>

          <div className="mt-8">
            <label
              htmlFor="service"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Pilih layanan
            </label>

            <select
              id="service"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-700 outline-none focus:border-blue-500"
              defaultValue="haircut"
            >
              <option value="haircut">Haircut</option>
              <option value="coloring">Hair Coloring</option>
              <option value="treatment">Hair Treatment</option>
            </select>
          </div>

          <button
            type="button"
            className="mt-6 w-full rounded-lg bg-blue-600 px-6 py-4 font-semibold text-white transition hover:bg-blue-700"
          >
            Ambil Nomor Antrian
          </button>

          <div className="mt-8 border-t border-slate-200 pt-8">
            <div className="text-center">
              <p className="text-sm text-slate-500">Nomor yang sedang dilayani</p>

              <p className="mt-2 text-5xl font-bold text-slate-900">
                A022
              </p>

              <p className="mt-4 text-sm text-slate-500">
                Estimasi waktu tunggu
              </p>

              <p className="mt-1 text-2xl font-semibold text-blue-600">
                ± 15 menit
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
