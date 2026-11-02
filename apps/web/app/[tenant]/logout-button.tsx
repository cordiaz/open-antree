"use client";

import { useState } from "react";
import { api } from "@/lib/api";

export function LogoutButton({ slug }: { slug: string }) {
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await api.logout(slug);
    } finally {
      // Full navigation so no page keeps showing staff data.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload drops any cached staff pages
      window.location.assign(`/${slug}/login`);
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="text-xs text-slate-500 hover:text-slate-900 hover:underline disabled:opacity-60"
    >
      Logout
    </button>
  );
}
