"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Keeps data fresh by re-fetching on an interval (paused while the tab is
// hidden). Realtime push can replace this later without changing callers.
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  initialData: T,
) {
  const [data, setData] = useState<T>(initialData);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const refresh = useCallback(async () => {
    try {
      setData(await fetcherRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat data");
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, refresh]);

  return { data, error, refresh };
}
