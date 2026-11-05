// Packages dist/ into release/ai-chat-navigator-<version>.zip for the Chrome Web Store.
//
//   pnpm package        (builds first)
//
// Writes a standard ZIP (deflate) with Node's built-in zlib; no dependencies.
// manifest.json sits at the root of the archive, as the store requires.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));

// Chrome Web Store rejects uploads over the hard limits; short_name over 12 is only truncated.
const overLimit = (limits) =>
  Object.entries(limits)
    .filter(([field, max]) => typeof manifest[field] === 'string' && [...manifest[field]].length > max)
    .map(([field, max]) => `  ${field}: ${[...manifest[field]].length} chars (max ${max})`);
const errors = overLimit({ name: 75, description: 132 });
if (errors.length) {
  console.error(`[cmn] manifest.json exceeds Chrome Web Store limits:\n${errors.join('\n')}`);
  process.exit(1);
}
const warnings = overLimit({ short_name: 12 });
if (warnings.length) console.warn(`[cmn] warning, may be truncated by Chrome:\n${warnings.join('\n')}`);

const outDir = join(root, 'release');
const outFile = join(outDir, `ai-chat-navigator-${manifest.version}.zip`);

function walk(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

// DOS date/time for 1980-01-01 00:00 keeps the archive reproducible.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

const locals = [];
const centrals = [];
let offset = 0;
for (const path of walk(dist)) {
  const name = Buffer.from(relative(dist, path).split('\\').join('/'), 'utf8');
  const data = readFileSync(path);
  const compressed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  locals.push(local, name, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);

  offset += local.length + name.length + compressed.length;
}

const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(centrals.length / 2, 8);
end.writeUInt16LE(centrals.length / 2, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, Buffer.concat([...locals, ...centrals, end]));
console.log(`[cmn] ${relative(root, outFile)} (${centrals.length / 2} files, ${Math.round(statSync(outFile).size / 1024)} KB)`);
