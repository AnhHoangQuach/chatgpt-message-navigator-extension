import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/** Content script: single self-contained IIFE file (no imports at runtime). */
export default defineConfig({
  publicDir: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome116',
    sourcemap: false,
    lib: {
      entry: resolve(dirname(fileURLToPath(import.meta.url)), 'src/content/content-script.ts'),
      formats: ['iife'],
      name: 'ChatGPTMessageNavigatorContent',
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: { extend: false },
    },
  },
});
