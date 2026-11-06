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
  // Whether customers can leave a WhatsApp number for notifications.
  whatsapp: boolean;
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
  // Masked WhatsApp number notifications go to, e.g. "••••7890".
  whatsapp: string | null;
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
  // Today's WhatsApp messages; null when notifications are off.
  notifications: { sent: number; failed: number; pending: number } | null;
};

// Counts and averages (minutes) for a set of tickets; see apps/api reports.
export type ReportMetrics = {
  total: number;
  completed: number;
  skipped: number;
  unfinished: number;
  avgWaitMinutes: number | null;
  avgServiceMinutes: number | null;
};

export type Report = {
  from: string;
  to: string;
  timezone: string;
  branch: { id: string; name: string } | null;
  summary: ReportMetrics;
  daily: (ReportMetrics & { date: string })[];
  byService: (ReportMetrics & {
    serviceId: string;
    name: string;
    ticketPrefix: string;
  })[];
  byCounter: (ReportMetrics & { counterId: string; name: string })[];
  byHour: { hour: number; total: number }[];
};

export type ReportQuery = { from?: string; to?: string; branchId?: string };

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "operator";
  tenant: { id: string; slug: string; name: string };
};

export type ManagedService = {
  id: string;
  branchId: string;
  name: string;
  ticketPrefix: string;
  avgServiceMinutes: number;
  isActive: boolean;
};

export type ManagedCounter = {
  id: string;
  branchId: string;
  name: string;
  isActive: boolean;
};

export type StaffUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "operator";
  isActive: boolean;
  createdAt: string;
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

// `init` is merged into every request; server pages pass the incoming
// request's cookies this way (see lib/server-api.ts).
export function createApi(init: RequestInit = {}) {
  const call = <T>(path: string, extra?: RequestInit) =>
    apiFetch<T>(path, {
      ...init,
      ...extra,
      headers: { ...init.headers, ...extra?.headers },
    });

  return {
    tenant: (slug: string) => call<TenantOverview>(tenantPath(slug)),
    queue: (slug: string) => call<QueueBoard>(`${tenantPath(slug)}/queue`),
    stats: (slug: string) => call<BranchStats>(`${tenantPath(slug)}/stats`),
    ticket: (slug: string, ticketId: string) =>
      call<Ticket>(`${tenantPath(slug)}/tickets/${ticketId}`),
    takeTicket: (
      slug: string,
      serviceId: string,
      customer: { customerName?: string; customerPhone?: string } = {},
    ) =>
      call<Ticket>(`${tenantPath(slug)}/tickets`, {
        method: "POST",
        body: JSON.stringify({ serviceId, ...customer }),
      }),
    counter: (slug: string, counterId: string) =>
      call<CounterConsole>(`${tenantPath(slug)}/counters/${counterId}`),
    callNext: (slug: string, counterId: string) =>
      call<{ ticket: Ticket | null }>(
        `${tenantPath(slug)}/counters/${counterId}/call-next`,
        { method: "POST" },
      ),
    transition: (
      slug: string,
      ticketId: string,
      action: "start" | "complete" | "skip",
    ) =>
      call<Ticket>(`${tenantPath(slug)}/tickets/${ticketId}/${action}`, {
        method: "POST",
      }),
    me: (slug: string) => call<AuthUser>(`${tenantPath(slug)}/auth/me`),
    login: (slug: string, email: string, password: string) =>
      call<AuthUser>(`${tenantPath(slug)}/auth/login`, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    logout: (slug: string) =>
      call<null>(`${tenantPath(slug)}/auth/logout`, { method: "POST" }),

    // Admin-only tenant configuration and reports.
    admin: {
      report: (slug: string, query: ReportQuery = {}) => {
        const params = new URLSearchParams(
          Object.entries(query).filter((entry): entry is [string, string] =>
            Boolean(entry[1]),
          ),
        );
        const search = params.size ? `?${params}` : "";
        return call<Report>(`${tenantPath(slug)}/admin/reports${search}`);
      },
      services: (slug: string) =>
        call<ManagedService[]>(`${tenantPath(slug)}/admin/services`),
      createService: (
        slug: string,
        body: Omit<ManagedService, "id" | "isActive">,
      ) =>
        call<ManagedService>(`${tenantPath(slug)}/admin/services`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      updateService: (
        slug: string,
        id: string,
        body: Partial<Omit<ManagedService, "id" | "branchId">>,
      ) =>
        call<ManagedService>(`${tenantPath(slug)}/admin/services/${id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      counters: (slug: string) =>
        call<ManagedCounter[]>(`${tenantPath(slug)}/admin/counters`),
      createCounter: (slug: string, body: { branchId: string; name: string }) =>
        call<ManagedCounter>(`${tenantPath(slug)}/admin/counters`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      updateCounter: (
        slug: string,
        id: string,
        body: { name?: string; isActive?: boolean },
      ) =>
        call<ManagedCounter>(`${tenantPath(slug)}/admin/counters/${id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      users: (slug: string) =>
        call<StaffUser[]>(`${tenantPath(slug)}/admin/users`),
      createUser: (
        slug: string,
        body: Pick<StaffUser, "email" | "name" | "role"> & { password: string },
      ) =>
        call<StaffUser>(`${tenantPath(slug)}/admin/users`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      updateUser: (
        slug: string,
        id: string,
        body: Partial<Pick<StaffUser, "name" | "role" | "isActive">> & {
          password?: string;
        },
      ) =>
        call<StaffUser>(`${tenantPath(slug)}/admin/users/${id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
    },
  };
}

// Browser-side client: cookies are sent automatically (same origin via /api).
export const api = createApi();

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
