"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePolling } from "./use-polling";

// Fallback refresh when the live stream is unavailable (or an event was missed).
const FALLBACK_POLL_MS = 30_000;
// Several changes often land together (e.g. complete + call next); refetch once.
const DEBOUNCE_MS = 150;

// Retry delays after the stream fails for good (see below), capped.
const RETRY_MIN_MS = 3_000;
const RETRY_MAX_MS = 30_000;

// Calls `onChange` whenever the tenant's queue changes, via the API's
// Server-Sent Events stream. Returns whether the stream is connected.
// Every (re)connect also triggers `onChange` so changes made while
// disconnected aren't missed.
export function useQueueEvents(slug: string, onChange: () => void): boolean {
  const [connected, setConnected] = useState(false);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let source: EventSource | null = null;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = RETRY_MIN_MS;
    let stopped = false;

    const trigger = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => onChangeRef.current(), DEBOUNCE_MS);
    };

    const connect = () => {
      source = new EventSource(
        `/api/tenants/${encodeURIComponent(slug)}/events`,
      );
      source.addEventListener("queue", trigger);
      source.addEventListener("open", () => {
        retryDelay = RETRY_MIN_MS;
        setConnected(true);
        trigger();
      });
      source.addEventListener("error", () => {
        setConnected(false);
        // EventSource retries a dropped connection by itself, but gives up
        // for good if a retry gets an error response (e.g. the API is down
        // and the proxy answers 500). Then reconnect ourselves, backing off.
        if (source?.readyState === EventSource.CLOSED && !stopped) {
          source.close();
          retry = setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
        }
      });
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(debounce);
      clearTimeout(retry);
      source?.close();
    };
  }, [slug]);

  return connected;
}

// Data that refreshes on every queue change, with slow polling as a safety net.
export function useLiveData<T>(
  slug: string,
  fetcher: () => Promise<T>,
  initialData: T,
) {
  const polling = usePolling(fetcher, FALLBACK_POLL_MS, initialData);
  const { refresh } = polling;
  const onChange = useCallback(() => void refresh(), [refresh]);
  const connected = useQueueEvents(slug, onChange);
  return { ...polling, connected };
}

export { FALLBACK_POLL_MS };
