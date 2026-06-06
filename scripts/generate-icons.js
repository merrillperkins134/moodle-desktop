#!/usr/bin/env node
/*
 * Installs the application icons used by electron-builder and at runtime.
 *
 * Source of truth: the brand masters in branding/
 *   branding/icon.png   512x512  → build/icons/<size>x<size>.png (full set)
 *                                 + build/icon.png + assets/icon.png (512)
 *   branding/tray.png   64x64     → assets/tray.png
 *
 * Why a full size set? electron-builder's auto-resize occasionally fails to
 * detect a PNG's dimensions and installs a single icon under an invalid
 * hicolor/0x0/ directory, which every desktop environment ignores (generic
 * icon shows instead). Pointing linux.icon at a directory of correctly-named,
 * pre-sized PNGs bypasses that detection entirely.
 *
 * If a master is missing, a Nextcloud-blue placeholder is generated so the
 * build never fails for lack of an icon. Drop new artwork into branding/
 * (same names) and rebuild to rebrand.
 *
 * Pure Node, no native deps: PNG decode (filters 0-4, non-interlaced,
 * 8-bit RGB/RGBA), area-average downscale, PNG encode.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const BRANDING_DIR = path.join(root, 'branding');
const ICON_SIZES = [512, 256, 128, 96, 64, 48, 32, 24, 16];

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

// --- PNG decode (8-bit, RGB/RGBA, non-interlaced, filters 0-4) -------------
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buf) {
  if (
    buf.length < 8 ||
    buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47
  ) {
    throw new Error('not a PNG');
  }
  let i = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    i += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG (bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace})`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos++];
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let val;
      switch (filter) {
        case 0: val = rawByte; break;
        case 1: val = rawByte + a; break;
        case 2: val = rawByte + b; break;
        case 3: val = rawByte + ((a + b) >> 1); break;
        case 4: val = rawByte + paeth(a, b, c); break;
        default: throw new Error('bad filter ' + filter);
      }
      cur[x] = val & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const si = x * channels;
      const di = (y * width + x) * 4;
      out[di] = cur[si];
      out[di + 1] = cur[si + 1];
      out[di + 2] = cur[si + 2];
      out[di + 3] = channels === 4 ? cur[si + 3] : 0xff;
    }
    cur.copy(prev);
  }
  return { width, height, data: out };
}

// --- Area-average downscale (premultiplied alpha to avoid edge fringing) ----
function resize(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return Buffer.from(src);
  const out = Buffer.alloc(dw * dh * 4);
  const sxRatio = sw / dw;
  const syRatio = sh / dh;
  for (let dy = 0; dy < dh; dy++) {
    const fy0 = dy * syRatio;
    const fy1 = (dy + 1) * syRatio;
    for (let dx = 0; dx < dw; dx++) {
      const fx0 = dx * sxRatio;
      const fx1 = (dx + 1) * sxRatio;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let sy = Math.floor(fy0); sy < Math.ceil(fy1); sy++) {
        const wy = Math.min(sy + 1, fy1) - Math.max(sy, fy0);
        if (wy <= 0) continue;
        for (let sx = Math.floor(fx0); sx < Math.ceil(fx1); sx++) {
          const wx = Math.min(sx + 1, fx1) - Math.max(sx, fx0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const si = (sy * sw + sx) * 4;
          const sa = src[si + 3] / 255;
          // premultiply
          r += src[si] * sa * w;
          g += src[si + 1] * sa * w;
          b += src[si + 2] * sa * w;
          a += src[si + 3] * w;
          wsum += w;
        }
      }
      const di = (dy * dw + dx) * 4;
      if (wsum === 0 || a === 0) {
        out[di] = out[di + 1] = out[di + 2] = out[di + 3] = 0;
        continue;
      }
      const alpha = a / wsum; // 0..255
      const am = alpha / 255;
      // un-premultiply
      out[di] = Math.round(Math.min(255, r / wsum / am));
      out[di + 1] = Math.round(Math.min(255, g / wsum / am));
      out[di + 2] = Math.round(Math.min(255, b / wsum / am));
      out[di + 3] = Math.round(alpha);
    }
  }
  return out;
}

// --- PNG encode (8-bit RGBA, filter 0) --------------------------------------
function encodePng(rgba, size) {
  const stride = size * 4;
  const rawLen = (stride + 1) * size;
  const raw = Buffer.alloc(rawLen);
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
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Placeholder drawing (fallback only) ------------------------------------
function drawPlaceholder(size) {
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
        data[i] = 0xff; data[i + 1] = 0xff; data[i + 2] = 0xff; data[i + 3] = 0xff;
      } else {
        data[i] = 0x00; data[i + 1] = bgG; data[i + 2] = bgB; data[i + 3] = 0xff;
      }
    }
  }
  return data;
}

// --- Install ----------------------------------------------------------------
function writeFileEnsured(filePath, buf) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
  console.log(`wrote ${path.relative(root, filePath)} (${buf.length} bytes)`);
}

// Load a 512x512 RGBA master from branding/, or fall back to the placeholder.
function loadMaster(name) {
  const master = path.join(BRANDING_DIR, name);
  if (fs.existsSync(master)) {
    try {
      const { width, height, data } = decodePng(fs.readFileSync(master));
      console.log(`using branding/${name} (${width}x${height})`);
      return { width, height, data };
    } catch (err) {
      console.warn(`branding/${name} could not be decoded (${err.message}) — using placeholder`);
    }
  } else {
    console.log(`branding/${name} not found — using placeholder`);
  }
  return { width: 512, height: 512, data: drawPlaceholder(512) };
}

// App icon: full hicolor size set + single 512 copies.
const app = loadMaster('icon.png');
const iconsDir = path.join(root, 'build', 'icons');
fs.rmSync(iconsDir, { recursive: true, force: true });
for (const size of ICON_SIZES) {
  const scaled = resize(app.data, app.width, app.height, size, size);
  writeFileEnsured(path.join(iconsDir, `${size}x${size}.png`), encodePng(scaled, size));
}
const icon512 = encodePng(resize(app.data, app.width, app.height, 512, 512), 512);
writeFileEnsured(path.join(root, 'build', 'icon.png'), icon512);
writeFileEnsured(path.join(root, 'assets', 'icon.png'), icon512);

// Tray icon (64x64).
const tray = loadMaster('tray.png');
const tray64 = encodePng(resize(tray.data, tray.width, tray.height, 64, 64), 64);
writeFileEnsured(path.join(root, 'assets', 'tray.png'), tray64);

console.log('Icon installation complete.');
