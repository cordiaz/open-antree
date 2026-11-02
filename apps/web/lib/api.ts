// Typed client for apps/api. On the server it calls the API directly; in the
// browser it goes through the /api rewrite in next.config.ts.

export type TicketStatus =
  | "waiting"
  | "called"
  | "serving"
  | "completed"
  | "skipped"
  | "cancelled";

export type TenantOverview = {
  slug: string;
  name: string;
  timezone: string;
  branches: {
    id: string;
    name: string;
    address: string | null;
    services: {
      id: string;
      name: string;
      ticketPrefix: string;
      avgServiceMinutes: number;
    }[];
    counters: { id: string; name: string }[];
  }[];
};

export type QueueBoard = {
  tenant: { slug: string; name: string };
  branch: { id: string; name: string };
  serviceDate: string;
  services: {
    id: string;
    name: string;
    ticketPrefix: string;
    nowServing: { code: string; status: TicketStatus; counter: string | null }[];
    waiting: number;
    estimatedWaitMinutes: number;
  }[];
};

export type Ticket = {
  id: string;
  code: string;
  status: TicketStatus;
  serviceDate: string;
  service: { id: string; name: string };
  counter: string | null;
  ahead: number;
  estimatedWaitMinutes: number;
  createdAt: string;
  calledAt: string | null;
  servedAt: string | null;
  completedAt: string | null;
};

export type CounterConsole = {
  counter: { id: string; name: string; branchId: string };
  current: Ticket | null;
  waiting: { id: string; code: string; service: string; createdAt: string }[];
};

export type BranchStats = {
  tenant: { slug: string; name: string };
  branch: { id: string; name: string };
  serviceDate: string;
  counters: number;
  tickets: {
    waiting: number;
    serving: number;
    completed: number;
    skipped: number;
  };
  averageWaitMinutes: number | null;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const baseUrl = () =>
  typeof window === "undefined"
    ? (process.env.API_URL ?? "http://localhost:4000")
    : "/api";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    cache: "no-store",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    // NestJS errors: { message: string | string[] }; validation errors are arrays.
    const message = body?.message;
    throw new ApiError(
      response.status,
      Array.isArray(message)
        ? message.join(", ")
        : (message ?? response.statusText),
    );
  }
  return body as T;
}

const tenantPath = (slug: string) => `/tenants/${encodeURIComponent(slug)}`;

export const api = {
  tenant: (slug: string) => apiFetch<TenantOverview>(tenantPath(slug)),
  queue: (slug: string) => apiFetch<QueueBoard>(`${tenantPath(slug)}/queue`),
  stats: (slug: string) => apiFetch<BranchStats>(`${tenantPath(slug)}/stats`),
  ticket: (slug: string, ticketId: string) =>
    apiFetch<Ticket>(`${tenantPath(slug)}/tickets/${ticketId}`),
  takeTicket: (slug: string, serviceId: string, customerName?: string) =>
    apiFetch<Ticket>(`${tenantPath(slug)}/tickets`, {
      method: "POST",
      body: JSON.stringify({ serviceId, customerName }),
    }),
  counter: (slug: string, counterId: string) =>
    apiFetch<CounterConsole>(`${tenantPath(slug)}/counters/${counterId}`),
  callNext: (slug: string, counterId: string) =>
    apiFetch<{ ticket: Ticket | null }>(
      `${tenantPath(slug)}/counters/${counterId}/call-next`,
      { method: "POST" },
    ),
  transition: (
    slug: string,
    ticketId: string,
    action: "start" | "complete" | "skip",
  ) =>
    apiFetch<Ticket>(`${tenantPath(slug)}/tickets/${ticketId}/${action}`, {
      method: "POST",
    }),
};

// For server pages: a missing tenant or counter should render the 404 page.
export async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}
