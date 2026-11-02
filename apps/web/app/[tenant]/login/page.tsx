import { notFound, redirect } from "next/navigation";
import { api, orNull } from "@/lib/api";
import { currentUser, homeFor } from "@/lib/server-api";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/login">) {
  const { tenant: slug } = await params;
  const { next } = await searchParams;

  const tenant = await orNull(api.tenant(slug));
  if (!tenant) {
    notFound();
  }

  // Only allow returning to a page of this tenant (no open redirects).
  const nextPath =
    typeof next === "string" && next.startsWith(`/${slug}/`) ? next : null;

  const user = await currentUser(slug);
  if (user) {
    redirect(nextPath ?? homeFor(user));
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-blue-600">OPEN ANTREE</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">
          {tenant.name}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Login untuk operator dan admin
        </p>

        <LoginForm slug={slug} nextPath={nextPath} />

        {process.env.NODE_ENV !== "production" && slug === "salon-mawar" && (
          <p className="mt-6 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            Demo (development): admin@salon-mawar.test atau
            operator@salon-mawar.test, password <code>antree-demo</code>
          </p>
        )}
      </div>
    </main>
  );
}
