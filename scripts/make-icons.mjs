// Generates the PWA icons (PNG) without any dependency: a tiny software rasterizer + PNG encoder.
// Run: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

function polygon(n, r, startDeg, dy = 0) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = ((startDeg + (i * 360) / n) * Math.PI) / 180;
    pts.push([Math.cos(a) * r, Math.sin(a) * r + dy]);
  }
  return pts;
}

const CYAN = hex('#3df5ff');
const MAGENTA = hex('#ff4fd8');

/** App icons: neon circle with a triangle inside, kept within the maskable safe zone (radius 0.8). */
const APP = {
  shapes: [
    { color: CYAN, pts: polygon(96, 0.6, 0) },
    { color: MAGENTA, pts: polygon(3, 0.34, -90, 0.05) },
  ],
  core: 0.026, // half line width, in normalized units (-1..1)
  glow: 0.11,
  glowAmount: 0.55,
  rounded: 0, // full-bleed square: the OS applies its own mask
};

/** Favicons: same design, but bigger shapes and much thicker lines so it reads at 16–32 px. */
const FAVICON = {
  shapes: [
    { color: CYAN, pts: polygon(64, 0.72, 0) },
    { color: MAGENTA, pts: polygon(3, 0.4, -90, 0.06) },
  ],
  core: 0.075,
  glow: 0.16,
  glowAmount: 0.35,
  rounded: 0.32, // rounded dark tile with transparent corners
};

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Signed distance to a rounded square covering the icon (negative inside). */
function roundedBoxDist(u, v, r) {
  const qx = Math.abs(u) - (1 - r);
  const qy = Math.abs(v) - (1 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function render(size, style) {
  const px = Buffer.alloc(size * size * 4);
  const bgIn = hex('#121a44');
  const bgOut = hex('#03040c');
  const SS = size <= 64 ? 4 : 1; // supersample small icons for clean edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS) / size) * 2 - 1;
          const v = ((y + (sy + 0.5) / SS) / size) * 2 - 1;
          const k = Math.min(1, Math.hypot(u, v) / 1.3);
          let rgb = bgIn.map((c, i) => c + (bgOut[i] - c) * k);
          for (const s of style.shapes) {
            let d = Infinity;
            for (let i = 1; i < s.pts.length; i++) d = Math.min(d, segDist(u, v, s.pts[i - 1], s.pts[i]));
            const glow = Math.exp(-((d / style.glow) ** 2)) * style.glowAmount;
            const aa = SS > 1 ? size * SS * 0.5 : size * 0.5;
            const core = Math.max(0, Math.min(1, (style.core - d) * aa + 0.5));
            const hot = Math.max(0, Math.min(1, (style.core * 0.4 - d) * aa + 0.5));
            rgb = rgb.map((c, i) => c + s.color[i] * (glow + core) + hot * 0.7);
          }
          const alpha = style.rounded ? (roundedBoxDist(u, v, style.rounded) <= 0 ? 1 : 0) : 1;
          rgb.forEach((c, i) => (acc[i] += Math.min(1, c) * alpha));
          acc[3] += alpha;
        }
      }
      const o = (y * size + x) * 4;
      const n = SS * SS;
      // Un-premultiply so edge pixels keep their color.
      for (let i = 0; i < 3; i++) px[o + i] = acc[3] ? Math.round((acc[i] / acc[3]) * 255) : 0;
      px[o + 3] = Math.round((acc[3] / n) * 255);
    }
  }
  return encodePng(size, px);
}

/** .ico file holding PNG images (supported by all current browsers and Windows Vista+). */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
const write = (path, data) => {
  writeFileSync(path, data);
  console.log(path);
};

// Installed app (manifest + iOS home screen).
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  write(`public/icons/${name}`, render(size, APP));
}

// Browser tab favicons.
const fav = (size) => ({ size, png: render(size, FAVICON) });
const [f16, f32, f48] = [fav(16), fav(32), fav(48)];
write('public/icons/favicon-32.png', f32.png);
write('public/favicon.ico', encodeIco([f16, f32, f48]));
