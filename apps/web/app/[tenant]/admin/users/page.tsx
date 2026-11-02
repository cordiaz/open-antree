import { notFound } from "next/navigation";
import { api, orNull } from "@/lib/api";
import { requireUser, serverApi } from "@/lib/server-api";
import { UsersManager } from "./users-manager";

export default async function UsersPage({
  params,
}: PageProps<"/[tenant]/admin/users">) {
  const { tenant: slug } = await params;
  const tenant = await orNull(api.tenant(slug));
  if (!tenant) {
    notFound();
  }
  const me = await requireUser(slug, `/${slug}/admin/users`, ["admin"]);
  const users = await (await serverApi()).admin.users(slug);

  return <UsersManager slug={slug} currentUserId={me.id} initialUsers={users} />;
}
