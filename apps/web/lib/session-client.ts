"use client";

import { ApiError } from "./api";

// Called when a staff request fails with 401 (session expired or logged out
// elsewhere): go to the tenant's login page and come back afterwards.
export function redirectToLoginIfUnauthorized(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 401) {
    return false;
  }
  const { pathname, search } = window.location;
  const slug = pathname.split("/")[1];
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload drops any cached staff pages
  window.location.assign(
    `/${slug}/login?next=${encodeURIComponent(pathname + search)}`,
  );
  return true;
}
