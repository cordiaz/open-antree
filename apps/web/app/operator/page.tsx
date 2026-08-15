const waitingQueues = ["A023", "A024", "A025", "A026"];

export default function OperatorPage() {
  return (
    <main className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm font-semibold text-blue-600">
              OPEN ANTREE
            </p>
            <h1 className="text-xl font-bold text-slate-900">
              Operator Console
            </h1>
          </div>

          <div className="text-right">
            <p className="text-sm text-slate-500">Counter</p>
            <p className="font-semibold text-slate-900">Counter 01</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid gap-6 lg:grid-cols-3">
          <section className="rounded-2xl bg-white p-8 shadow-sm lg:col-span-2">
            <p className="text-center text-sm font-medium uppercase tracking-wider text-slate-500">
              Sedang Dilayani
            </p>

            <p className="mt-4 text-center text-8xl font-bold text-slate-900">
              A022
            </p>

            <p className="mt-4 text-center text-slate-500">
              Haircut
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="rounded-lg bg-blue-600 px-5 py-4 font-semibold text-white hover:bg-blue-700"
              >
                Panggil Berikutnya
              </button>

              <button
                type="button"
                className="rounded-lg border border-slate-300 px-5 py-4 font-semibold text-slate-700 hover:bg-slate-50"
              >
                Selesaikan
              </button>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">
              Waiting Queue
            </h2>

            <div className="mt-5 space-y-3">
              {waitingQueues.map((queue) => (
                <div
                  key={queue}
                  className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3"
                >
                  <span className="font-semibold text-slate-900">
                    {queue}
                  </span>

                  <span className="text-sm text-slate-500">
                    Waiting
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
