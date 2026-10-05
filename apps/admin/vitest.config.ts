import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts: vitest 3 ships Vite 7 types which do not
// unify with the Vite 6 types used by the app config.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
