import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { fs: { allow: ['..'] } },
  test: { include: ['src/**/*.test.ts'] },
});
