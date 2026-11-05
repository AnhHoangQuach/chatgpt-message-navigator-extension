// Generates the extension's PNG icons from the brand logo.
//
//   pnpm icons
//
// Source: assets/brand/logo-source.png, square artwork of a rounded tile on
// either a transparent background (used as is) or a white one (made
// transparent: only the white connected to the image edges, so white artwork
// inside the tile is kept). The image is cropped to the tile and resized to
// every size the manifest uses.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(root, 'assets/brand/logo-source.png');
const OUT_DIR = resolve(root, 'public/icons');

/** Output size → transparent padding on each side (Chrome asks for ~1/8 padding on the 128px store icon). */
const SIZES = { 16: 0, 32: 1, 48: 2, 128: 8 };

/** A background pixel's blue channel is near 255; the tile's yellow/orange edge has blue near 20. */
const BG_MIN_BLUE = 60;
/** Background-connected pixels bluer than this are cut away (midpoint of the edge blend). */
const EDGE_CUTOFF_BLUE = 140;

/** Square crop around the opaque pixels of an RGBA buffer. */
function squareCrop(rgba, W, H) {
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let p = 0; p < W * H; p++) {
    if (rgba[p * 4 + 3] <= 128) continue;
    const x = p % W;
    const y = (p - x) / W;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const side = Math.max(maxX - minX, maxY - minY) + 1;
  const left = Math.max(0, Math.round((minX + maxX + 1 - side) / 2));
  const top = Math.max(0, Math.round((minY + maxY + 1 - side) / 2));
  return { left, top, width: Math.min(side, W - left), height: Math.min(side, H - top) };
}

async function cutOut(input) {
  // Already transparent around the tile: keep the artwork's own alpha.
  const rgba = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const corner = rgba.data[3];
  if (corner === 0) {
    const crop = squareCrop(rgba.data, rgba.info.width, rgba.info.height);
    return sharp(rgba.data, { raw: { width: rgba.info.width, height: rgba.info.height, channels: 4 } }).extract(crop).png().toBuffer();
  }

  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const out = Buffer.alloc(W * H * 4);
  const background = new Uint8Array(W * H);

  // Flood-fill the background from the image border.
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = y * W + x;
    if (background[p] || data[p * 3 + 2] <= BG_MIN_BLUE) return;
    background[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < W; x++) push(x, 0), push(x, H - 1);
  for (let y = 0; y < H; y++) push(0, y), push(W - 1, y);
  while (stack.length) {
    const p = stack.pop();
    const x = p % W;
    const y = (p - x) / W;
    push(x + 1, y), push(x - 1, y), push(x, y + 1), push(x, y - 1);
  }

  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let p = 0; p < W * H; p++) {
    const [r, g, b] = [data[p * 3], data[p * 3 + 1], data[p * 3 + 2]];
    // Hard mask at full resolution: the soft glow around the tile would show
    // as a light halo on dark toolbars. Downscaling anti-aliases the edge.
    const a = background[p] && b > EDGE_CUTOFF_BLUE ? 0 : 1;
    out[p * 4] = r;
    out[p * 4 + 1] = g;
    out[p * 4 + 2] = b;
    out[p * 4 + 3] = a * 255;
    if (a > 0.5) {
      const x = p % W;
      const y = (p - x) / W;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  // Square crop centred on the tile.
  const side = Math.max(maxX - minX, maxY - minY) + 1;
  const left = Math.max(0, Math.round((minX + maxX + 1 - side) / 2));
  const top = Math.max(0, Math.round((minY + maxY + 1 - side) / 2));
  return sharp(out, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left, top, width: Math.min(side, W - left), height: Math.min(side, H - top) })
    .png()
    .toBuffer();
}

mkdirSync(OUT_DIR, { recursive: true });
const tile = await cutOut(SOURCE);
for (const [size, pad] of Object.entries(SIZES).map(([s, p]) => [Number(s), p])) {
  const inner = size - pad * 2;
  const file = resolve(OUT_DIR, `icon-${size}.png`);
  await sharp(tile)
    .resize(inner, inner, { kernel: 'lanczos3' })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(file);
  console.log(`wrote public/icons/icon-${size}.png`);
}
