import { notFound } from "next/navigation";
import { api, orNull } from "@/lib/api";
import { QueueClient } from "./queue-client";

export default async function QueuePage({
  params,
}: PageProps<"/[tenant]/queue">) {
  const { tenant: slug } = await params;
  const [tenant, queue] = await Promise.all([
    orNull(api.tenant(slug)),
    orNull(api.queue(slug)),
  ]);
  if (!tenant || !queue) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-lg">
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="text-center">
            <p className="text-sm font-medium text-blue-600">OPEN ANTREE</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-900">
              {tenant.name}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {queue.branch.name} · Ambil nomor antrian secara online
            </p>
          </div>

          <QueueClient slug={slug} initialQueue={queue} />
        </div>
      </div>
    </main>
  );
}
