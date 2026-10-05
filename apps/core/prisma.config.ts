import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

// pnpm runs Prisma from apps/core; the development .env lives at the repo root.
// Injected environment variables take precedence, just as in the app loader.
const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (process.env.SKIP_DOTENV !== '1' && existsSync(envFile)) {
  loadEnvFile(envFile);
}

export default defineConfig({ schema: 'prisma/schema.prisma' });
