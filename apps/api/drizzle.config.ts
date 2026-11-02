import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit does not read .env on its own; prefer the shared root .env.
for (const file of ['.env', '../../.env']) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
