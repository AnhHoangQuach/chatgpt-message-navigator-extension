// Builds the extension into dist/: extension pages + service worker (ESM),
// then the content script (IIFE). Pass --watch for a rebuild-on-change dev loop.
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const watchOpts = watch ? { build: { watch: {} } } : {};

rmSync(resolve(root, 'dist'), { recursive: true, force: true });

await build({ root, configFile: resolve(root, 'vite.config.ts'), mode: watch ? 'development' : 'production', ...watchOpts });
await build({ root, configFile: resolve(root, 'vite.content.config.ts'), mode: watch ? 'development' : 'production', ...watchOpts });

if (watch) {
  console.log('\n[cmn] Watching for changes. Reload the extension in chrome://extensions after rebuilds.');
} else {
  console.log('\n[cmn] Build complete: load the dist/ folder as an unpacked extension.');
}
