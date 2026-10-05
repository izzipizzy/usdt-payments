import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC emits decorator metadata (esbuild does not), which NestJS DI needs.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' }, jsc: { target: 'es2022', transform: { decoratorMetadata: true, legacyDecorator: true } } })],
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 20000,
  },
});
