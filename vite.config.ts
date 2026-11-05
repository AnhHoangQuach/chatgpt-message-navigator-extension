import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

/** Copies the root manifest.json into the build output. */
function copyManifest(): Plugin {
  return {
    name: 'cmn-copy-manifest',
    apply: 'build',
    writeBundle(options) {
      const outDir = options.dir ?? resolve(root, 'dist');
      mkdirSync(outDir, { recursive: true });
      copyFileSync(resolve(root, 'manifest.json'), resolve(outDir, 'manifest.json'));
    },
  };
}

/**
 * Builds the extension pages (side panel) and the background service worker
 * as ES modules. The content script is built separately as an IIFE
 * (see vite.content.config.ts) because content scripts cannot be ES modules.
 */
export default defineConfig({
  plugins: [tailwindcss(), copyManifest()],
  base: '',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome116',
    sourcemap: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        sidepanel: resolve(root, 'src/sidepanel/index.html'),
        'service-worker': resolve(root, 'src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'service-worker' ? 'service-worker.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
