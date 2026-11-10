import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { factoryRoot, siteRoot } from './paths.ts';

const sansCandidates = [
  'C:/Windows/Fonts/segoeui.ttf',
  'C:/Windows/Fonts/segoeuib.ttf',
  'C:/Windows/Fonts/calibri.ttf',
  'C:/Windows/Fonts/calibrib.ttf',
  'C:/Windows/Fonts/arial.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
];

const wordmarkColors = ['#1d7ad6', '#2e9a45', '#c9a227'];
const fredokaWoff = path.join(siteRoot, 'node_modules', '@fontsource', 'fredoka', 'files', 'fredoka-latin-600-normal.woff');
const roundedFallbacks = [
  { file: 'C:/Windows/Fonts/comic.ttf', family: 'Comic Sans MS' },
  { file: 'C:/Windows/Fonts/calibri.ttf', family: 'Calibri' },
  { file: 'C:/Windows/Fonts/segoeui.ttf', family: 'Segoe UI' },
];

let fredokaFile: string | null = null;

function woffToSfnt(woff: Buffer) {
  if (woff.toString('ascii', 0, 4) !== 'wOFF') throw new Error('Fredoka file is not WOFF');
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  const tables: { tag: string; checksum: number; data: Buffer }[] = [];
  for (let index = 0; index < numTables; index += 1) {
    const dir = 44 + index * 20;
    const tag = woff.toString('ascii', dir, dir + 4);
    const offset = woff.readUInt32BE(dir + 4);
    const compLength = woff.readUInt32BE(dir + 8);
    const origLength = woff.readUInt32BE(dir + 12);
    const checksum = woff.readUInt32BE(dir + 16);
    const compressed = woff.subarray(offset, offset + compLength);
    const data = compLength === origLength ? Buffer.from(compressed) : zlib.inflateSync(compressed);
    if (data.length !== origLength) throw new Error(`Bad Fredoka table ${tag}`);
    tables.push({ tag, checksum, data });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const searchRange = 2 ** Math.floor(Math.log2(numTables)) * 16;
  const entrySelector = Math.floor(Math.log2(numTables));
  const rangeShift = numTables * 16 - searchRange;
  let cursor = 12 + numTables * 16;
  const placed = tables.map((table) => {
    const record = { ...table, offset: cursor };
    cursor += table.data.length + ((4 - (table.data.length % 4)) % 4);
    return record;
  });
  const out = Buffer.alloc(cursor);
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(searchRange, 6);
  out.writeUInt16BE(entrySelector, 8);
  out.writeUInt16BE(rangeShift, 10);
  placed.forEach((table, index) => {
    const start = 12 + index * 16;
    out.write(table.tag, start, 'ascii');
    out.writeUInt32BE(table.checksum, start + 4);
    out.writeUInt32BE(table.offset, start + 8);
    out.writeUInt32BE(table.data.length, start + 12);
    table.data.copy(out, table.offset);
  });
  return out;
}

function wordmarkFontFile() {
  if (fredokaFile && fs.existsSync(fredokaFile)) return { file: fredokaFile, family: 'Fredoka' };
  if (fs.existsSync(fredokaWoff)) {
    const ttf = woffToSfnt(fs.readFileSync(fredokaWoff));
    const dest = path.join(os.tmpdir(), 'sfl-fredoka-latin-600.ttf');
    fs.writeFileSync(dest, ttf);
    fredokaFile = dest;
    return { file: dest, family: 'Fredoka' };
  }
  return roundedFallbacks.find((item) => fs.existsSync(item.file)) ?? null;
}

function wordmarkSvg(brand: string, baseline: number, size: number, family: string) {
  let colorIndex = 0;
  const letters = [...brand].map((char) => {
    if (char === ' ') return '<tspan> </tspan>';
    const color = wordmarkColors[colorIndex % wordmarkColors.length];
    colorIndex += 1;
    return `<tspan fill="${color}">${xml(char)}</tspan>`;
  });
  return `<text x="500" y="${baseline}" text-anchor="middle" font-family="${xml(family)}" font-size="${size}" font-weight="600" letter-spacing="0.3">${letters.join('')}</text>`;
}

const PIN_W = 1000;
const PIN_H = 1500;

function xml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function wrap(value: string, max: number, maxLines = 2) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

function fitLineSize(text: string, maxWidth: number, start: number, min: number) {
  for (let size = start; size >= min; size -= 2) {
    if (text.length * size * 0.62 <= maxWidth) return size;
  }
  return min;
}

function collectionNameLine(title: string) {
  return title
    .trim()
    .replace(/\s+coloring\s+pages\s*$/i, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

async function heroImage(image: Buffer) {
  const flat = await sharp(image).flatten({ background: '#ffffff' }).png().toBuffer();
  try {
    return await sharp(flat).trim({ background: '#ffffff', threshold: 18 }).png().toBuffer();
  } catch {
    return flat;
  }
}

export async function renderPin(options: {
  title: string;
  accent: string;
  brand: string;
  image: Buffer;
}) {
  const hero = await heroImage(options.image);
  const meta = await sharp(hero).metadata();
  const iw = meta.width || 1;
  const ih = meta.height || 1;

  const titleLines = options.title.trim() ? wrap(options.title, 28) : [];
  const hasTitle = titleLines.length > 0;
  const titleSize = titleLines.length > 1 ? 40 : 46;
  const titleLineH = titleSize + 10;
  const brandSize = 36;
  const labelSize = 34;

  const marginX = 32;
  const maxArtW = PIN_W - marginX * 2;
  const brandH = 44;
  // When the category heading is hidden, the brand sits directly above the art.
  // Give that transition extra room so the wordmark does not feel attached to the drawing.
  const gapBrand = hasTitle ? 16 : 48;
  const gapTitle = 28;
  const gapLabel = 46;
  const labelH = 42;
  const titleH = titleLines.length * titleLineH;
  const textChrome = brandH + gapBrand + (hasTitle ? titleH + gapTitle : 0) + gapLabel + labelH;
  const maxArtH = PIN_H - 72 - textChrome;
  const scale = Math.min(maxArtW / iw, maxArtH / ih);
  const artW = Math.round(iw * scale);
  const artH = Math.round(ih * scale);
  const stackH = textChrome + artH;
  const top = Math.max(36, Math.round((PIN_H - stackH) / 2));

  let y = top;
  const brandBaseline = y + brandSize;
  y += brandH + gapBrand;
  const titleBaselines = titleLines.map((_, index) => y + titleSize + index * titleLineH);
  y += titleH + (hasTitle ? gapTitle : 0);
  const artX = Math.round((PIN_W - artW) / 2);
  const artY = y;
  y += artH + gapLabel;
  const labelBaseline = y + labelSize;

  const wordmark = wordmarkFontFile();
  const href = `data:image/png;base64,${hero.toString('base64')}`;
  const display = wordmark?.family ?? 'Fredoka';
  const title = titleBaselines
    .map(
      (baseline, index) =>
        `<text x="500" y="${baseline}" text-anchor="middle" font-family="${xml(display)}" font-size="${titleSize}" font-weight="600" fill="#1A1A1A">${xml(titleLines[index])}</text>`,
    )
    .join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_W}" height="${PIN_H}" viewBox="0 0 ${PIN_W} ${PIN_H}">
  <rect width="${PIN_W}" height="${PIN_H}" fill="#FFFFFF"/>
  ${wordmarkSvg(options.brand, brandBaseline, brandSize, display)}
  ${title}
  <image href="${href}" x="${artX}" y="${artY}" width="${artW}" height="${artH}" preserveAspectRatio="xMidYMid meet"/>
  <text x="500" y="${labelBaseline}" text-anchor="middle" font-family="${xml(display)}" font-size="${labelSize}" font-weight="600" fill="${xml(options.accent)}" letter-spacing="1.2">FREE PRINTABLE</text>
</svg>`;

  return rasterize(svg);
}

function inkOn(hex: string) {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 168 ? '#1A1A1A' : '#FFFFFF';
}

/** Collection pin: 3×3 grid, colored title bar, wordmark on the bottom row. */
export async function renderCollectionPin(options: {
  title: string;
  accent: string;
  brand: string;
  images: Buffer[];
}) {
  if (options.images.length < 9) throw new Error('A collection pin needs 9 drawings');
  const COLS = 3;
  const bandH = 248;
  const gap = 6;
  const padX = 10;
  const padY = 10;
  const cellW = Math.floor((PIN_W - padX * 2 - gap * (COLS - 1)) / COLS);
  const cellH = Math.floor((PIN_H - padY * 2 - gap * 3 - bandH) / 3);
  const gridW = cellW * COLS + gap * (COLS - 1);
  const originX = Math.round((PIN_W - gridW) / 2);
  const bandY = padY + cellH * 2 + gap * 2;
  const cells: { x: number; y: number; w: number; h: number }[] = [];
  for (let row = 0; row < 3; row += 1) {
    const y = row < 2 ? padY + row * (cellH + gap) : bandY + bandH + gap;
    for (let col = 0; col < COLS; col += 1) {
      cells.push({ x: originX + col * (cellW + gap), y, w: cellW, h: cellH });
    }
  }

  const tiles = await Promise.all(
    options.images.slice(0, 9).map(async (image, index) => {
      const hero = await heroImage(image);
      const cell = cells[index];
      const png = await sharp(hero)
        .resize(cell.w, cell.h, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .png()
        .toBuffer();
      return { input: png, left: cell.x, top: cell.y };
    }),
  );

  const ink = inkOn(options.accent);
  const wordmark = wordmarkFontFile();
  const family = wordmark?.family ?? 'Fredoka';
  const nameLine = collectionNameLine(options.title) || 'COLORING';
  const pagesLine = 'COLORING PAGES';
  const pillLines = ['Free PDF', 'Printables'];
  const pillW = 390;
  const pillH = 168;
  const pillX = PIN_W - 18 - pillW;
  const pillY = bandY + Math.round((bandH - pillH) / 2);
  const titleLeft = 24;
  const titleMaxW = pillX - 20 - titleLeft;
  const nameSize = fitLineSize(nameLine, titleMaxW, 74, 42);
  const pagesSize = fitLineSize(pagesLine, titleMaxW, 66, 42);
  const titleGap = 4;
  const titleBlockH = nameSize + titleGap + pagesSize;
  const titleTop = bandY + Math.round((bandH - titleBlockH) / 2) + nameSize - 4;
  const title = [
    `<text x="${titleLeft}" y="${titleTop}" font-family="${xml(family)}" font-size="${nameSize}" font-weight="600" fill="${ink}">${xml(nameLine)}</text>`,
    `<text x="${titleLeft}" y="${titleTop + titleGap + pagesSize}" font-family="${xml(family)}" font-size="${pagesSize}" font-weight="600" fill="${ink}">${xml(pagesLine)}</text>`,
  ].join('');
  const pillFill = ink === '#FFFFFF' ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.12)';
  const pillSize = 52;
  const pillLineH = 60;
  const pillTextTop = pillY + Math.round((pillH - pillLineH * 2) / 2) + pillSize - 4;
  const pillText = pillLines
    .map(
      (line, index) =>
        `<text x="${pillX + pillW / 2}" y="${pillTextTop + index * pillLineH}" text-anchor="middle" font-family="${xml(family)}" font-size="${pillSize}" font-weight="600" fill="${ink}">${xml(line)}</text>`,
    )
    .join('');
  const frames = cells
    .map(
      (cell) =>
        `<rect x="${cell.x + 1.5}" y="${cell.y + 1.5}" width="${cell.w - 3}" height="${cell.h - 3}" fill="none" stroke="#222222" stroke-width="3"/>`,
    )
    .join('');
  const brandSize = 44;
  const frameSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_W}" height="${PIN_H}" viewBox="0 0 ${PIN_W} ${PIN_H}">
  ${frames}
</svg>`;
  const chromeSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_W}" height="${PIN_H}" viewBox="0 0 ${PIN_W} ${PIN_H}">
  <rect x="0" y="${bandY + 5}" width="${PIN_W}" height="${bandH}" fill="rgba(0,0,0,0.16)"/>
  <rect x="0" y="${bandY}" width="${PIN_W}" height="${bandH}" fill="${xml(options.accent)}"/>
  ${title}
  <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="14" ry="14" fill="${pillFill}"/>
  ${pillText}
  <text x="500" y="${PIN_H - 28}" text-anchor="middle" font-family="${xml(family)}" font-size="${brandSize}" font-weight="600" fill="#ffffff" stroke="#ffffff" stroke-width="12" stroke-linejoin="round">${xml(options.brand)}</text>
  ${wordmarkSvg(options.brand, PIN_H - 28, brandSize, family)}
</svg>`;

  const pencils = await pinPencilsOverlay();
  return sharp({
    create: { width: PIN_W, height: PIN_H, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([
      ...tiles,
      { input: await rasterize(frameSvg) },
      { input: await rasterize(chromeSvg) },
      ...(pencils ? [{ input: pencils, left: 0, top: 0 }] : []),
    ])
    .png()
    .toBuffer();
}

/** Full-pin overlay. Uses the PNG alpha as-is. */
async function pinPencilsOverlay() {
  const file = path.join(factoryRoot, 'assets', 'pin-pencils.png');
  if (!fs.existsSync(file)) return null;
  return sharp(file).resize(PIN_W, PIN_H, { fit: 'fill' }).png().toBuffer();
}

function rasterize(svg: string) {
  const wordmark = wordmarkFontFile();
  const fontFiles = [...sansCandidates, wordmark?.file].filter((file): file is string => Boolean(file && fs.existsSync(file)));
  const resvg = new Resvg(svg, {
    font: {
      fontFiles,
      loadSystemFonts: true,
      defaultFontFamily: wordmark?.family ?? 'Segoe UI',
    },
    fitTo: { mode: 'width', value: PIN_W },
  });
  return Buffer.from(resvg.render().asPng());
}

export function pinFileName(themeId: string, pinId: string) {
  return `${themeId}-${pinId}.png`;
}

export function safePinPath(root: string, themeId: string, pinId: string) {
  return path.join(root, pinFileName(themeId, pinId));
}
