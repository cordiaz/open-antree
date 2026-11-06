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

## Realtime updates

`GET /tenants/:slug/events` is a [Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events) stream of the tenant's queue changes:

```
event: queue
data: {"type":"ticket.called","branchId":"…","ticketId":"…","at":"2026-11-02T10:19:09.842Z"}
```

- Types: `ticket.created`, `ticket.called`, `ticket.updated`, `config.updated` (services/counters changed), `staff.updated` (a password reset or deactivation ended sessions).
- Events carry ids only, never customer data, so the stream is public like the queue board. Clients refetch what they display.
- Changes are published to Redis (`queue-events:<tenantId>`), so every API instance delivers every change, whichever instance handled the request. Each process holds one Redis subscription per tenant with open streams, released when the last client leaves.
- A comment line every 25 s keeps idle connections alive through proxies; on shutdown open streams are ended so the process can exit and browsers reconnect to the new one.
- Publishing never fails a request: if Redis is unavailable the change still happens and clients catch up through fallback polling.



| Method | Path | Description |
| --- | --- | --- |
| POST | `/tenants/:slug/auth/login` | `{ email, password }` → sets the `antree_session` cookie and returns the user |
| POST | `/tenants/:slug/auth/logout` | Ends the session |
| GET | `/tenants/:slug/auth/me` | The logged-in user, or `401` |

- Sessions are random tokens stored in Redis (keyed by their SHA-256) for `SESSION_TTL_HOURS` (default 12). The cookie is `HttpOnly` and `SameSite=Lax`; set `COOKIE_SECURE=true` when served over HTTPS.
- A session only works on its own tenant (`403` elsewhere). `admin` can do everything; `operator` can't read `/stats`.
- Deactivating a user (`users.is_active = false`) rejects their existing sessions immediately.
- After 5 failed logins an account is locked for 15 minutes (`429`).

## Admin management

Admin-only endpoints for configuring a tenant. Nothing is hard-deleted: services and counters are referenced by ticket history, so they are deactivated instead (inactive items disappear from the customer and operator pages).

| Method | Path | Description |
| --- | --- | --- |
| GET / POST | `/tenants/:slug/admin/services` | List (including inactive) / create `{ branchId, name, ticketPrefix, avgServiceMinutes }` |
| PATCH | `/tenants/:slug/admin/services/:id` | Change `name`, `ticketPrefix` (new tickets only), `avgServiceMinutes`, `isActive` |
| GET / POST | `/tenants/:slug/admin/counters` | List / create `{ branchId, name }` |
| PATCH | `/tenants/:slug/admin/counters/:id` | Change `name`, `isActive`; a counter handling a ticket can't be deactivated (`409`) |
| GET / POST | `/tenants/:slug/admin/users` | List (never includes password hashes) / create `{ email, name, role, password }` |
| PATCH | `/tenants/:slug/admin/users/:id` | Change `name`, `role`, `isActive`, `password` |

- Duplicate prefixes, counter names (per branch) and emails (per tenant) return `409`.
- An admin can't deactivate or demote their own account, so a tenant always keeps an active admin.
- Setting a password or deactivating a user ends all of that user's sessions (an admin changing their own password keeps the current one).

The admin pages in `apps/web` cover all of this. For the first admin of a new tenant, or without the web app, use the script:

(The password comes from the environment so it stays out of shell history.)

```bash
USER_PASSWORD='...' pnpm user:create --tenant salon-mawar --email budi@example.com --name "Budi" --role operator
```

The demo seed creates `admin@salon-mawar.test` and `operator@salon-mawar.test` with password `antree-demo` (override with `SEED_PASSWORD`).

## Reports

`GET /tenants/:slug/admin/reports?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId=<uuid>` (admins only) summarises ticket history. All parameters are optional: without them the report covers the last 7 days up to today in the tenant's timezone, across all branches. A range may span at most 92 days; invalid dates, a reversed range or a longer one return `400`, an unknown branch `404`.

The response contains a `summary` and the same figures `daily` (every day of the range, including empty ones), `byService`, `byCounter` (tickets each counter called) and `byHour` (tickets taken per hour of day, 0–23, in the tenant's timezone):

| Field | Meaning |
| --- | --- |
| `total` | Tickets taken |
| `completed` / `skipped` | Finished as completed / skipped (no-show) |
| `unfinished` | Neither: still in the queue, or left over when the day ended |
| `avgWaitMinutes` | From taking a ticket to being called |
| `avgServiceMinutes` | From starting service (or the call, if service was never started) to completion |

Averages are `null` when no ticket qualifies. Reports contain counts and times only, never customer names or phone numbers.

## WhatsApp notifications

Customers may leave a WhatsApp number when taking a ticket. They then get up to two messages:

- **near**: once their ticket has `WHATSAPP_NEAR_AHEAD` (default 3) or fewer tickets ahead. Not sent if the ticket was already that close when taken.
- **called**: when a counter calls the ticket, with the counter's name.

Messages are written to the `notifications` table in the same transaction that calls the ticket (an outbox), and a background worker in the API delivers them. A slow or failing provider never delays the queue, and messages survive restarts. Several API instances can run side by side; rows are claimed with `FOR UPDATE SKIP LOCKED`, and each ticket gets at most one message of each kind.

- Network errors, rate limits and provider server errors are retried up to 5 attempts (30 s, 1 min, 2 min, ...). A rejected number, bad token or rejected template fails immediately.
- A message that no longer applies is skipped instead of sent: a "near" message for a ticket that has been called, or a "called" message for a ticket already being served or more than 15 minutes old.
- Numbers are stored as digits with country code (`0812-3456-7890` becomes `6281234567890`, using `PHONE_COUNTRY_CODE` for a leading 0). Public ticket responses only show a masked number (`••••7890`). Reports never include numbers.
- The admin dashboard shows today's sent, pending and failed counts (`notifications` in `GET /tenants/:slug/stats`; `null` when off).

Choose a provider with `WHATSAPP_DRIVER`:

| Driver | Settings | Notes |
| --- | --- | --- |
| `off` (default) | | The customer page doesn't ask for a number; numbers sent anyway are not stored |
| `log` | | Prints messages to the API log; for development |
| `apicoid` | `WHATSAPP_APICOID_API_KEY`, `WHATSAPP_APICOID_TEMPLATE_NEAR`, `WHATSAPP_APICOID_TEMPLATE_CALLED`, optional `WHATSAPP_APICOID_LANGUAGE` (`id`), `WHATSAPP_APICOID_PHONE_NUMBER_ID` (account default), `WHATSAPP_APICOID_BASE_URL` (`https://chat.api.co.id`) | [api.co.id Chat API](https://docs.api.co.id/chat-api/getting-started/), an official WhatsApp Business API provider. API keys are under Developers → API Keys; uses approved templates |
| `fonnte` | `FONNTE_TOKEN` | [Fonnte](https://fonnte.com) sends free text from a linked WhatsApp number |
| `meta` | `WHATSAPP_META_TOKEN`, `WHATSAPP_META_PHONE_NUMBER_ID`, `WHATSAPP_META_TEMPLATE_NEAR`, `WHATSAPP_META_TEMPLATE_CALLED`, optional `WHATSAPP_META_LANGUAGE` (`id`), `WHATSAPP_META_API_VERSION` (`v23.0`) | Official WhatsApp Cloud API. Business-initiated messages must use templates approved in WhatsApp Manager |

Missing settings for the chosen driver stop the API at startup.

For `apicoid` and `meta`, create two **Utility** templates in Indonesian with positional body parameters, for example:

- near (`{{1}}` ticket code, `{{2}}` business name, `{{3}}` tickets ahead): *Nomor antrean {{1}} di {{2}} tinggal {{3}} nomor lagi sebelum dipanggil. Mohon bersiap dan tetap berada di sekitar lokasi.*
- called (`{{1}}` ticket code, `{{2}}` counter, `{{3}}` business name): *Nomor antrean {{1}} sekarang dipanggil. Silakan menuju {{2}} di {{3}}. Terima kasih.*

Meta rejects templates that start or end with a variable, and a rejected template name can't be reused.

Free-text drivers (`log`, `fonnte`) send the same wording, greeting the customer by name when given.

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Start with watch mode |
| `pnpm build` | Compile to `dist/` |
| `pnpm start:prod` | Run the compiled build |
| `pnpm lint` | oxlint (type-aware) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Unit tests (vitest) |
| `pnpm test:e2e` | End-to-end tests (vitest + supertest); most need the docker-compose PostgreSQL and Redis running |
| `pnpm db:generate` | Generate a SQL migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Recreate the demo tenant `salon-mawar` with today's tickets and 13 days of finished history (for reports) |
| `pnpm user:create` | Create a staff account (see Authentication) |
| `pnpm db:studio` | Open Drizzle Studio to browse the database |
