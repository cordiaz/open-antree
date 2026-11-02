import Link from "next/link";
import { notFound } from "next/navigation";
import { api, orNull } from "@/lib/api";
import { currentUser } from "@/lib/server-api";
import { LogoutButton } from "../logout-button";
import { AdminNav } from "./admin-nav";

// Shared header and tabs for the admin area. Each page checks the session
// itself, since layouts don't re-run on every navigation, and redirects to
// login with its own path so the admin lands back on it.
export default async function AdminLayout({
  params,
  children,
}: LayoutProps<"/[tenant]/admin">) {
  const { tenant: slug } = await params;
  const tenant = await orNull(api.tenant(slug));
  if (!tenant) {
    notFound();
  }
  const user = await currentUser(slug);
  if (user?.role !== "admin") {
    // Not an admin: render no admin chrome; the page redirects.
    return children;
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 pt-5">
          <div>
            <p className="text-sm font-semibold text-blue-600">
              OPEN ANTREE · {tenant.name}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">
              Tenant Admin
            </h1>
          </div>
          <p className="text-right text-xs text-slate-500">
            {user.name} ·{" "}
            <Link
              href={`/${slug}/operator`}
              className="text-blue-600 hover:underline"
            >
              Operator Console
            </Link>{" "}
            · <LogoutButton slug={slug} />
          </p>
        </div>
        <AdminNav slug={slug} />
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
    </main>
  );
}
