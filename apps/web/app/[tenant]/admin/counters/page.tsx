import { notFound } from "next/navigation";
import { api, orNull } from "@/lib/api";
import { requireUser, serverApi } from "@/lib/server-api";
import { CountersManager } from "./counters-manager";

export default async function CountersPage({
  params,
}: PageProps<"/[tenant]/admin/counters">) {
  const { tenant: slug } = await params;
  const tenant = await orNull(api.tenant(slug));
  if (!tenant) {
    notFound();
  }
  await requireUser(slug, `/${slug}/admin/counters`, ["admin"]);
  const counters = await (await serverApi()).admin.counters(slug);

  return (
    <CountersManager
      slug={slug}
      branches={tenant.branches.map((b) => ({ id: b.id, name: b.name }))}
      initialCounters={counters}
    />
  );
}
