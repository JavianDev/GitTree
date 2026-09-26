import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Integration tests shell out to real git in temp dirs; give them room.
    testTimeout: 30_000,
  },
});
