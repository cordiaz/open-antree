import Link from "next/link";
import { notFound } from "next/navigation";
import { api, orNull } from "@/lib/api";
import { OperatorConsole } from "./operator-console";

export default async function OperatorPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/operator">) {
  const { tenant: slug } = await params;
  const { counter: counterParam } = await searchParams;
  const counterId = typeof counterParam === "string" ? counterParam : null;

  const tenant = await orNull(api.tenant(slug));
  if (!tenant) {
    notFound();
  }

  const counter = counterId ? await orNull(api.counter(slug, counterId)) : null;

  return (
    <main className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm font-semibold text-blue-600">
              OPEN ANTREE · {tenant.name}
            </p>
            <h1 className="text-xl font-bold text-slate-900">
              Operator Console
            </h1>
          </div>
          {counter && (
            <div className="text-right">
              <p className="text-sm text-slate-500">Counter</p>
              <p className="font-semibold text-slate-900">
                {counter.counter.name}
              </p>
              <Link
                href={`/${slug}/operator`}
                className="text-xs text-blue-600 hover:underline"
              >
                Ganti counter
              </Link>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {counter ? (
          <OperatorConsole slug={slug} initialConsole={counter} />
        ) : (
          <section className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">
              Pilih counter
            </h2>
            {counterId && (
              <p className="mt-2 text-sm text-red-600">
                Counter tidak ditemukan.
              </p>
            )}
            {tenant.branches.map((branch) => (
              <div key={branch.id} className="mt-5">
                <p className="text-sm text-slate-500">{branch.name}</p>
                <div className="mt-2 grid gap-2">
                  {branch.counters.map((c) => (
                    <Link
                      key={c.id}
                      href={`/${slug}/operator?counter=${c.id}`}
                      className="rounded-lg border border-slate-300 px-4 py-3 font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {c.name}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
