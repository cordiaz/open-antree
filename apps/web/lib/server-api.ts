import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError, createApi, type AuthUser } from "./api";

// API client for server components that forwards the visitor's cookies, so
// staff endpoints see the session.
export async function serverApi() {
  const cookie = (await cookies()).toString();
  return createApi({ headers: { cookie } });
}

export const homeFor = (user: AuthUser) =>
  `/${user.tenant.slug}/${user.role === "admin" ? "admin" : "operator"}`;

// The logged-in staff member for this tenant, or null.
export async function currentUser(slug: string): Promise<AuthUser | null> {
  try {
    return await (await serverApi()).me(slug);
  } catch (error) {
    // 401: not logged in; 403: logged in to another tenant.
    if (error instanceof ApiError && [401, 403].includes(error.status)) {
      return null;
    }
    throw error;
  }
}

// Redirects to the tenant's login page unless a staff member with one of
// `roles` is logged in. `path` is where to come back after logging in.
export async function requireUser(
  slug: string,
  path: string,
  roles: AuthUser["role"][] = ["admin", "operator"],
): Promise<AuthUser> {
  const user = await currentUser(slug);
  if (!user) {
    redirect(`/${slug}/login?next=${encodeURIComponent(path)}`);
  }
  if (!roles.includes(user.role)) {
    redirect(homeFor(user));
  }
  return user;
}
