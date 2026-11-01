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

> **Not authenticated yet.** Operator endpoints are open to anyone who knows a counter or ticket id. Authentication is a later phase.

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
| `pnpm db:studio` | Open Drizzle Studio to browse the database |
