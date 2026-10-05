import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** Needs DATABASE_URL and REDIS_URL pointing at disposable instances (see docker-compose.yml). */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' }, jsc: { target: 'es2022', transform: { decoratorMetadata: true, legacyDecorator: true } } })],
  test: {
    include: ['src/**/*.itest.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
