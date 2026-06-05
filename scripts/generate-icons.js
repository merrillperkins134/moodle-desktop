#!/usr/bin/env node
/*
 * Generates placeholder application icons with zero runtime dependencies.
 *
 * Produces:
 *   build/icon.png   512x512  (used by electron-builder for .deb / AppImage)
 *   assets/icon.png  512x512  (used as the runtime window icon)
 *   assets/tray.png  64x64    (used for the system tray icon)
 *
 * The image is a simple Nextcloud-blue square with a white cloud mark.
 * Replace these files with real branding whenever you like.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// --- CRC32 (for PNG chunk checksums) ---------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// --- Drawing ----------------------------------------------------------------
function drawIcon(size) {
  const s = size;
  const px = (x, y) => ({ x: x / s, y: y / s }); // normalized helpers unused; keep explicit math below

  // Work in a 512 design space and scale to the requested size.
  const scale = s / 512;
  const circles = [
    [256, 290, 95],
    [180, 315, 62],
    [335, 315, 70],
    [225, 245, 68],
    [300, 250, 55],
  ].map(([cx, cy, r]) => [cx * scale, cy * scale, r * scale]);

  const bar = {
    x0: 175 * scale,
    x1: 340 * scale,
    y0: 300 * scale,
    y1: 360 * scale,
  };

  const data = Buffer.alloc(s * s * 4);

  const inCloud = (x, y) => {
    for (const [cx, cy, r] of circles) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) return true;
    }
    if (x >= bar.x0 && x <= bar.x1 && y >= bar.y0 && y <= bar.y1) return true;
    return false;
  };

  for (let y = 0; y < s; y++) {
    // Vertical gradient from #0082C9 (top) to #005A8C (bottom).
    const t = y / (s - 1);
    const bgR = Math.round(0x00 + (0x00 - 0x00) * t);
    const bgG = Math.round(0x82 + (0x5a - 0x82) * t);
    const bgB = Math.round(0xc9 + (0x8c - 0xc9) * t);
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      if (inCloud(x + 0.5, y + 0.5)) {
        data[i] = 0xff;
        data[i + 1] = 0xff;
        data[i + 2] = 0xff;
        data[i + 3] = 0xff;
      } else {
        data[i] = bgR;
        data[i + 1] = bgG;
        data[i + 2] = bgB;
        data[i + 3] = 0xff;
      }
    }
  }
  return data;
}

function encodePng(size) {
  const rgba = drawIcon(size);
  // Add filter byte (0 = none) at the start of each scanline.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function writeFileEnsured(filePath, buf) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
  console.log(`wrote ${path.relative(process.cwd(), filePath)} (${buf.length} bytes)`);
}

const root = path.resolve(__dirname, '..');
writeFileEnsured(path.join(root, 'build', 'icon.png'), encodePng(512));
writeFileEnsured(path.join(root, 'assets', 'icon.png'), encodePng(512));
writeFileEnsured(path.join(root, 'assets', 'tray.png'), encodePng(64));

console.log('Icon generation complete.');
