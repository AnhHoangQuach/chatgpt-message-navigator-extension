import { defineConfig } from 'vitest/config';

// JSX compiles to Preact via tsconfig.json ("jsxImportSource": "preact").
export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'https://chatgpt.com/' } },
    include: ['src/tests/**/*.test.{ts,tsx}'],
    setupFiles: ['src/tests/setup.ts'],
    restoreMocks: true,
  },
});
