import { notFound } from "next/navigation";
import { api, orNull } from "@/lib/api";
import { requireUser, serverApi } from "@/lib/server-api";
import { ServicesManager } from "./services-manager";

export default async function ServicesPage({
  params,
}: PageProps<"/[tenant]/admin/services">) {
  const { tenant: slug } = await params;
  const tenant = await orNull(api.tenant(slug));
  if (!tenant) {
    notFound();
  }
  await requireUser(slug, `/${slug}/admin/services`, ["admin"]);
  const services = await (await serverApi()).admin.services(slug);

  return (
    <ServicesManager
      slug={slug}
      branches={tenant.branches.map((b) => ({ id: b.id, name: b.name }))}
      initialServices={services}
    />
  );
}
