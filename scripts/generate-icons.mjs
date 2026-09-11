import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "icons");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4).copy(raw, y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const TEAL = [14, 116, 144];
const BAR = [255, 255, 255];
const BAR_ALPHA = 235;

function insideRoundedRect(x, y, size, corner) {
  if (corner <= 0) return true;
  const x0 = corner;
  const y0 = corner;
  const x1 = size - corner - 1;
  const y1 = size - corner - 1;
  if (x < x0 && y < y0) return (x - x0) ** 2 + (y - y0) ** 2 <= corner ** 2;
  if (x > x1 && y < y0) return (x - x1) ** 2 + (y - y0) ** 2 <= corner ** 2;
  if (x < x0 && y > y1) return (x - x0) ** 2 + (y - y1) ** 2 <= corner ** 2;
  if (x > x1 && y > y1) return (x - x1) ** 2 + (y - y1) ** 2 <= corner ** 2;
  return true;
}

/** ساخت آیکن: پس‌زمینهٔ تیم + سه قفسهٔ سفید در وسط */
function makeIcon(size, { rounded, contentInset = 0 }) {
  const px = new Uint8Array(size * size * 4);
  const corner = rounded ? size * 0.22 : 0;
  const bgInset = rounded ? size * 0.1 : 0;

  const barW = size * (0.6 - contentInset * 2);
  const barH = size * 0.09;
  const gap = size * 0.15;
  const contentTop = size * 0.5;
  const barXs = (size - barW) / 2;
  const startY = contentTop - (barH * 1.5 + gap);
  const rows = [0, 1, 2].map((i) => startY + i * (barH + gap));
  const barCorner = Math.max(2, size * 0.02);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inBgOutside = !rounded || insideRoundedRect(x, y, size, corner);
      const inBgInner = insideRoundedRect(x - bgInset, y - bgInset, size - 2 * bgInset, size * 0.18);
      if (!inBgOutside) {
        px[i] = 0;
        px[i + 1] = 0;
        px[i + 2] = 0;
        px[i + 3] = 0;
        continue;
      }
      let r = TEAL[0];
      let g = TEAL[1];
      let b = TEAL[2];
      let a = 255;
      if (!inBgInner) {
        // ضدِ مستطیل: شفاف
        a = 0;
      }
      for (const ry of rows) {
        if (y >= ry && y < ry + barH && x >= barXs && x < barXs + barW) {
          if (insideRoundedRect(x - barXs, y - ry, barW, barCorner)) {
            r = BAR[0];
            g = BAR[1];
            b = BAR[2];
            a = BAR_ALPHA;
          }
        }
      }
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = a;
    }
  }
  return encodePng(size, px);
}

mkdirSync(outDir, { recursive: true });

const icons = [
  { name: "icon-192.png", size: 192, rounded: true, contentInset: 0 },
  { name: "icon-512.png", size: 512, rounded: true, contentInset: 0 },
  { name: "maskable-512.png", size: 512, rounded: false, contentInset: 0.08 },
  { name: "favicon.png", size: 64, rounded: true, contentInset: 0 },
];

for (const icon of icons) {
  const png = makeIcon(icon.size, icon);
  const target = join(outDir, icon.name);
  writeFileSync(target, png);
  console.log("نوشته شد:", target, `(${png.length} bytes)`);
}