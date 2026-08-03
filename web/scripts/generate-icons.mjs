// One-shot icon generator. Emits solid-accent-color PNGs with a simple
// play-triangle motif into web/public/icons/. Placeholders — replace with
// designed artwork any time (same filenames, and the manifest keeps working).
//
// Usage: node scripts/generate-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const BG = [0x1e, 0xd7, 0x60]; // Spotify green
const FG = [0x06, 0x24, 0x16]; // dark green

function inPlayTriangle(x, y, size) {
  // Equilateral-ish triangle pointing right, roughly centered.
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.28;
  const ax = cx - r * 0.6, ay = cy - r;
  const bx = cx - r * 0.6, by = cy + r;
  const cxp = cx + r, cyp = cy;

  // Barycentric point-in-triangle test.
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d2 = (x - cxp) * (by - cyp) - (bx - cxp) * (y - cyp);
  const d3 = (x - ax) * (cyp - ay) - (cxp - ax) * (y - ay);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

function makePNG(size) {
  const w = size, h = size;
  const rowLen = 1 + w * 3;
  const raw = Buffer.alloc(rowLen * h);
  for (let y = 0; y < h; y++) {
    const off = y * rowLen;
    raw[off] = 0; // no filter
    for (let x = 0; x < w; x++) {
      const inTri = inPlayTriangle(x, y, size);
      const [r, g, b] = inTri ? FG : BG;
      raw[off + 1 + x * 3] = r;
      raw[off + 2 + x * 3] = g;
      raw[off + 3 + x * 3] = b;
    }
  }
  const idat = deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = path.resolve(__dirname, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

for (const size of [180, 192, 512]) {
  const png = makePNG(size);
  const dest = path.join(outDir, `icon-${size}.png`);
  writeFileSync(dest, png);
  console.log(`wrote ${dest} (${png.length} bytes)`);
}

// Also emit a tiny SVG favicon for browsers that support it.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1ed760"/><polygon points="24,18 24,46 46,32" fill="#062416"/></svg>`;
writeFileSync(path.resolve(__dirname, "..", "public", "favicon.svg"), svg);
console.log("wrote favicon.svg");
