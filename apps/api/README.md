# api

Open Antree backend, built with NestJS. Connects to PostgreSQL and Redis from the root `docker-compose.yml`.

## Development

From the monorepo root:

```bash
cp .env.example .env
docker compose up -d
pnpm --filter api db:migrate
pnpm --filter api db:seed   # optional demo tenant "salon-mawar"
pnpm --filter api dev
```

The API listens on `http://localhost:4000` (`API_PORT`).

## Database

PostgreSQL via [Drizzle ORM](https://orm.drizzle.team). The schema lives in `src/database/schema.ts`; SQL migrations are generated into `drizzle/` and committed.

| Table | Description |
| --- | --- |
| `tenants` | A business using Open Antree; `slug` is used in public URLs (`/salon-mawar/queue`) |
| `branches` | Locations of a tenant |
| `services` | What customers queue for at a branch; `ticket_prefix` gives codes like `A023` |
| `counters` | Desks/stations where operators serve tickets |
| `users` | Staff accounts (`admin` or `operator`) of a tenant; email unique per tenant, password hashed with scrypt |
| `tickets` | Queue entries; numbering restarts daily per service (`service_date`, `number`) and `status` is `waiting`, `called`, `serving`, `completed`, `skipped` or `cancelled` |

Every tenant-owned table has a `tenant_id` column so queries can always be scoped to one tenant.

To change the schema: edit `schema.ts`, run `pnpm db:generate --name <change>`, review the generated SQL, then `pnpm db:migrate`.

## Endpoints

All tenant endpoints are addressed by the tenant's `slug` and only ever touch that tenant's rows.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | `200` with `{ status: "ok", checks: { database, redis } }` when both are reachable, `503` naming the one that is down otherwise |
| GET | `/tenants/:slug` | Tenant with its active branches, services and counters |
| GET | `/tenants/:slug/queue?branchId=` | Public queue board per service: tickets being served, number waiting, rough wait estimate. Defaults to the tenant's first branch |
| POST | `/tenants/:slug/tickets` | Take a ticket: `{ serviceId, customerName?, customerPhone? }` |
| GET | `/tenants/:slug/tickets/:ticketId` | Ticket status, people ahead and estimated wait |
| GET | `/tenants/:slug/counters/:counterId` | Operator console: the counter's current ticket and the branch's waiting line |
| POST | `/tenants/:slug/counters/:counterId/call-next` | Call the oldest waiting ticket to this counter (optional `{ serviceId }`). `409` if the counter is still handling a ticket; `{ ticket: null }` if nobody is waiting |
| POST | `/tenants/:slug/tickets/:ticketId/start` | `called` → `serving` |
| POST | `/tenants/:slug/tickets/:ticketId/complete` | `called`/`serving` → `completed` |
| POST | `/tenants/:slug/tickets/:ticketId/skip` | `called` → `skipped` (customer didn't show up) |

Invalid transitions return `409`. Ticket numbers are assigned under a per-service, per-day advisory lock, and `call-next` uses `FOR UPDATE SKIP LOCKED`, so concurrent customers and counters never get duplicate numbers or the same ticket.

Staff endpoints (counters, ticket transitions, stats) require a session for the tenant in the URL; customer endpoints stay public.

## Authentication

| Method | Path | Description |
| --- | --- | --- |
| POST | `/tenants/:slug/auth/login` | `{ email, password }` → sets the `antree_session` cookie and returns the user |
| POST | `/tenants/:slug/auth/logout` | Ends the session |
| GET | `/tenants/:slug/auth/me` | The logged-in user, or `401` |

- Sessions are random tokens stored in Redis (keyed by their SHA-256) for `SESSION_TTL_HOURS` (default 12). The cookie is `HttpOnly` and `SameSite=Lax`; set `COOKIE_SECURE=true` when served over HTTPS.
- A session only works on its own tenant (`403` elsewhere). `admin` can do everything; `operator` can't read `/stats`.
- Deactivating a user (`users.is_active = false`) rejects their existing sessions immediately.
- After 5 failed logins an account is locked for 15 minutes (`429`).

Create staff accounts with (the password comes from the environment so it stays out of shell history):

```bash
USER_PASSWORD='...' pnpm user:create --tenant salon-mawar --email budi@example.com --name "Budi" --role operator
```

The demo seed creates `admin@salon-mawar.test` and `operator@salon-mawar.test` with password `antree-demo` (override with `SEED_PASSWORD`).

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Start with watch mode |
| `pnpm build` | Compile to `dist/` |
| `pnpm start:prod` | Run the compiled build |
| `pnpm lint` | oxlint (type-aware) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Unit tests (vitest) |
| `pnpm test:e2e` | End-to-end tests (vitest + supertest); `test/queue.e2e-spec.ts` needs the docker-compose PostgreSQL running |
| `pnpm db:generate` | Generate a SQL migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Recreate the demo tenant `salon-mawar` with today's tickets |
| `pnpm user:create` | Create a staff account (see Authentication) |
| `pnpm db:studio` | Open Drizzle Studio to browse the database |
