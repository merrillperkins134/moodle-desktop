#!/usr/bin/env node
/*
 * Installs the application icons used by electron-builder and at runtime.
 *
 * Source of truth: the brand masters in branding/
 *   branding/icon.png   512x512  → build/icon.png + assets/icon.png
 *   branding/tray.png   64x64     → assets/tray.png
 *
 * If a master is missing, a simple Nextcloud-blue placeholder is generated so
 * the build never fails for lack of an icon. Drop new artwork into branding/
 * (same names/sizes) and rebuild to rebrand.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const BRANDING_DIR = path.join(root, 'branding');

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

// --- Placeholder drawing (fallback only) ------------------------------------
function drawIcon(size) {
  const s = size;
  const scale = s / 512;
  const circles = [
    [256, 290, 95],
    [180, 315, 62],
    [335, 315, 70],
    [225, 245, 68],
    [300, 250, 55],
  ].map(([cx, cy, r]) => [cx * scale, cy * scale, r * scale]);

  const bar = { x0: 175 * scale, x1: 340 * scale, y0: 300 * scale, y1: 360 * scale };
  const data = Buffer.alloc(s * s * 4);

  const inCloud = (x, y) => {
    for (const [cx, cy, r] of circles) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) return true;
    }
    return x >= bar.x0 && x <= bar.x1 && y >= bar.y0 && y <= bar.y1;
  };

  for (let y = 0; y < s; y++) {
    const t = y / (s - 1);
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
        data[i] = 0x00;
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
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Install ----------------------------------------------------------------
function writeFileEnsured(filePath, buf) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
  console.log(`wrote ${path.relative(root, filePath)} (${buf.length} bytes)`);
}

// Use the brand master if present, otherwise fall back to a generated icon.
function resolveIcon(masterName, size) {
  const master = path.join(BRANDING_DIR, masterName);
  if (fs.existsSync(master)) {
    console.log(`using branding/${masterName}`);
    return fs.readFileSync(master);
  }
  console.log(`branding/${masterName} not found — generating ${size}x${size} placeholder`);
  return encodePng(size);
}

const appIcon = resolveIcon('icon.png', 512);
const trayIcon = resolveIcon('tray.png', 64);

writeFileEnsured(path.join(root, 'build', 'icon.png'), appIcon);
writeFileEnsured(path.join(root, 'assets', 'icon.png'), appIcon);
writeFileEnsured(path.join(root, 'assets', 'tray.png'), trayIcon);

console.log('Icon installation complete.');
