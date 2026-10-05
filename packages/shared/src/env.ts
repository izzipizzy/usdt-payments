import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load a .env file for local development without overriding variables already set.
 * Looks in the current directory and up to three parents (monorepo root). No-op in containers (env is injected).
 */
export function loadDotenv(): string | null {
  if (process.env.SKIP_DOTENV === '1') return null;
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      const loader = (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile;
      if (loader) {
        loader.call(process, candidate);
        return candidate;
      }
      return null;
    }
    dir = resolve(dir, '..');
  }
  return null;
}
