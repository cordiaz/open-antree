# api

Open Antree backend, built with NestJS. Connects to PostgreSQL and Redis from the root `docker-compose.yml`.

## Development

From the monorepo root:

```bash
cp .env.example .env
docker compose up -d
pnpm --filter api dev
```

The API listens on `http://localhost:4000` (`API_PORT`).

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | `200` with `{ status: "ok", checks: { database, redis } }` when both are reachable, `503` naming the one that is down otherwise |

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Start with watch mode |
| `pnpm build` | Compile to `dist/` |
| `pnpm start:prod` | Run the compiled build |
| `pnpm lint` | oxlint (type-aware) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Unit tests (vitest) |
| `pnpm test:e2e` | End-to-end tests (vitest + supertest) |
