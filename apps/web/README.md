# web

Open Antree frontend, built with Next.js (App Router) and Tailwind CSS. All data comes from `apps/api`.

## Development

Start the API first (see `apps/api/README.md`), then from the monorepo root:

```bash
pnpm --filter web dev
```

Open http://localhost:3000. With the demo seed (`pnpm --filter api db:seed`) the pages below work for the tenant `salon-mawar`.

## Pages

| Path | For | Description |
| --- | --- | --- |
| `/` | Everyone | Landing page |
| `/[tenant]/queue` | Customers | Pick a service, take a ticket, follow its status (ticket is remembered in the browser) |
| `/[tenant]/login` | Staff | Login for operators and admins; returns to the page that asked for it |
| `/[tenant]/operator` | Operators, admins | Choose a counter, then call / start / skip / complete tickets |
| `/[tenant]/admin` | Admins | Today's numbers for the branch and business details |
| `/[tenant]/admin/services` | Admins | Add services, edit name / prefix / average minutes, activate or deactivate |
| `/[tenant]/admin/counters` | Admins | Add, rename, activate or deactivate counters |
| `/[tenant]/admin/users` | Admins | Add staff accounts, change name / role, reset passwords, activate or deactivate |

Pages render their first data on the server and then refresh by polling (queue 5 s, operator 3 s, admin 10 s).

Operator and admin pages redirect to `/[tenant]/login` without a session (and operators are sent away from `/admin`). Server pages forward the visitor's cookies to the API (`lib/server-api.ts`); if a session ends while a page is open, the next poll sends the user back to the login page.

## Talking to the API

- Server components call the API directly at `API_URL` (default `http://localhost:4000`).
- The browser calls `/api/...` on the web origin; `next.config.ts` rewrites it to `API_URL`, so no CORS setup or build-time URL is needed.

Set `API_URL` in `apps/web/.env.local` or the environment if the API runs elsewhere.

The typed client lives in `lib/api.ts`.
