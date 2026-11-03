// Vitest config kept separate from vite.config.js because Vite's root is src/ but tests live in tests/.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    coverage: { provider: 'v8', include: ['src/core/**', 'electron/allowlist.js'] },
  },
});
