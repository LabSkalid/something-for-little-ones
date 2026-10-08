import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { siteRoot } from './paths.ts';

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

function wrap(value: string, max: number) {
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
  return lines.slice(0, 2);
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

  const titleLines = wrap(options.title, 28);
  const titleSize = titleLines.length > 1 ? 40 : 46;
  const titleLineH = titleSize + 10;
  const brandSize = 36;
  const labelSize = 34;

  const marginX = 32;
  const maxArtW = PIN_W - marginX * 2;
  const brandH = 44;
  const gapBrand = 16;
  const gapTitle = 28;
  const gapLabel = 30;
  const labelH = 42;
  const titleH = titleLines.length * titleLineH;
  const textChrome = brandH + gapBrand + titleH + gapTitle + gapLabel + labelH;
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
  y += titleH + gapTitle;
  const artX = Math.round((PIN_W - artW) / 2);
  const artY = y;
  y += artH + gapLabel;
  const labelBaseline = y + labelSize;

  const wordmark = wordmarkFontFile();
  const href = `data:image/png;base64,${hero.toString('base64')}`;
  const title = titleBaselines
    .map(
      (baseline, index) =>
        `<text x="500" y="${baseline}" text-anchor="middle" font-family="Segoe UI" font-size="${titleSize}" font-weight="700" fill="#1A1A1A">${xml(titleLines[index])}</text>`,
    )
    .join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_W}" height="${PIN_H}" viewBox="0 0 ${PIN_W} ${PIN_H}">
  <rect width="${PIN_W}" height="${PIN_H}" fill="#FFFFFF"/>
  ${wordmarkSvg(options.brand, brandBaseline, brandSize, wordmark?.family ?? 'Fredoka')}
  ${title}
  <image href="${href}" x="${artX}" y="${artY}" width="${artW}" height="${artH}" preserveAspectRatio="xMidYMid meet"/>
  <text x="500" y="${labelBaseline}" text-anchor="middle" font-family="Segoe UI" font-size="${labelSize}" font-weight="800" fill="${xml(options.accent)}" letter-spacing="1.6">FREE PRINTABLE</text>
</svg>`;

  return rasterize(svg);
}

function fitBox(iw: number, ih: number, cellW: number, cellH: number, cellX: number, cellY: number) {
  const scale = Math.min(cellW / iw, cellH / ih);
  const w = Math.round(iw * scale);
  const h = Math.round(ih * scale);
  return {
    x: Math.round(cellX + (cellW - w) / 2),
    y: Math.round(cellY + (cellH - h) / 2),
    w,
    h,
  };
}

async function preparedArts(images: Buffer[]) {
  const heroes = await Promise.all(images.map((image) => heroImage(image)));
  return Promise.all(
    heroes.map(async (hero) => {
      const meta = await sharp(hero).metadata();
      return {
        href: `data:image/png;base64,${hero.toString('base64')}`,
        iw: meta.width || 1,
        ih: meta.height || 1,
      };
    }),
  );
}

/** Collection pin for the theme page: 3 or 4 different drawings. */
export async function renderCollectionPin(options: {
  title: string;
  accent: string;
  brand: string;
  images: Buffer[];
  /** Soft rounded frame around each tile — helps older, busier pages read as a grid. */
  framed?: boolean;
}) {
  const count = options.images.length >= 4 ? 4 : 3;
  if (options.images.length < 3) throw new Error('A collection pin needs 3 or 4 drawings');
  const framed = options.framed !== false;
  const arts = await preparedArts(options.images.slice(0, count));
  const titleLines = wrap(options.title, 34);
  const titleSize = titleLines.length > 1 ? 38 : 44;
  const titleLineH = titleSize + 8;
  const brandSize = 32;
  const labelSize = 34;
  const wordmark = wordmarkFontFile();
  const marginX = 40;
  const gap = framed ? 22 : 28;
  const brandH = 40;
  const gapBrand = 12;
  const gapTitle = 20;
  const gapLabel = 28;

  let y = 34;
  const brandBaseline = y + brandSize;
  y += brandH + gapBrand;
  const titleBaselines = titleLines.map((_, index) => y + titleSize + index * titleLineH);
  y += titleLines.length * titleLineH + gapTitle;
  const artTop = y;
  const labelBaseline = PIN_H - 52;
  const artBottom = labelBaseline - gapLabel - 8;
  const artW = PIN_W - marginX * 2;
  const artH = artBottom - artTop;
  // Pack a tight grid sized to the drawings, then center the whole block
  // so rows don't stretch apart to fill the pin height.
  const maxRatio = Math.max(...arts.map((art) => art.ih / Math.max(1, art.iw)), 1);
  const cells: { x: number; y: number; w: number; h: number }[] = [];
  if (count === 4) {
    const cellW = (artW - gap) / 2;
    const idealCellH = cellW * maxRatio;
    const cellH = Math.min(idealCellH, (artH - gap) / 2);
    const gridH = cellH * 2 + gap;
    const gridW = cellW * 2 + gap;
    const originX = marginX + (artW - gridW) / 2;
    const originY = artTop + (artH - gridH) / 2;
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 2; col += 1) {
        cells.push({
          x: originX + col * (cellW + gap),
          y: originY + row * (cellH + gap),
          w: cellW,
          h: cellH,
        });
      }
    }
  } else {
    const bottomCellW = (artW - gap) / 2;
    const topCellW = artW;
    const idealTopH = topCellW * maxRatio;
    const idealBottomH = bottomCellW * maxRatio;
    const scale = Math.min(1, artH / (idealTopH + gap + idealBottomH));
    const topH = idealTopH * scale;
    const bottomH = idealBottomH * scale;
    const gridH = topH + gap + bottomH;
    const originY = artTop + (artH - gridH) / 2;
    cells.push({ x: marginX, y: originY, w: topCellW, h: topH });
    cells.push({ x: marginX, y: originY + topH + gap, w: bottomCellW, h: bottomH });
    cells.push({
      x: marginX + bottomCellW + gap,
      y: originY + topH + gap,
      w: bottomCellW,
      h: bottomH,
    });
  }

  const title = titleBaselines
    .map(
      (baseline, index) =>
        `<text x="500" y="${baseline}" text-anchor="middle" font-family="Segoe UI" font-size="${titleSize}" font-weight="700" fill="#1A1A1A">${xml(titleLines[index])}</text>`,
    )
    .join('');
  const inset = framed ? 16 : 0;
  const radius = 22;
  const stroke = 4;
  const drawings = arts
    .map((art, index) => {
      const cell = cells[index];
      const inner = {
        x: cell.x + inset,
        y: cell.y + inset,
        w: cell.w - inset * 2,
        h: cell.h - inset * 2,
      };
      const box = fitBox(art.iw, art.ih, inner.w, inner.h, inner.x, inner.y);
      const chrome = framed
        ? [
            `<rect x="${cell.x}" y="${cell.y}" width="${cell.w}" height="${cell.h}" rx="${radius}" ry="${radius}" fill="#FAFBFC"/>`,
            `<rect x="${cell.x + stroke / 2}" y="${cell.y + stroke / 2}" width="${cell.w - stroke}" height="${cell.h - stroke}" rx="${radius - 2}" ry="${radius - 2}" fill="none" stroke="${xml(options.accent)}" stroke-width="${stroke}"/>`,
          ].join('\n')
        : '';
      return `${chrome}
<image href="${art.href}" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" preserveAspectRatio="xMidYMid meet"/>`;
    })
    .join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_W}" height="${PIN_H}" viewBox="0 0 ${PIN_W} ${PIN_H}">
  <rect width="${PIN_W}" height="${PIN_H}" fill="#FFFFFF"/>
  ${wordmarkSvg(options.brand, brandBaseline, brandSize, wordmark?.family ?? 'Fredoka')}
  ${title}
  ${drawings}
  <text x="500" y="${labelBaseline}" text-anchor="middle" font-family="Segoe UI" font-size="${labelSize}" font-weight="800" fill="${xml(options.accent)}" letter-spacing="1.4">FREE PRINTABLES</text>
</svg>`;
  return rasterize(svg);
}

function rasterize(svg: string) {
  const wordmark = wordmarkFontFile();
  const fontFiles = [...sansCandidates, wordmark?.file].filter((file): file is string => Boolean(file && fs.existsSync(file)));
  const resvg = new Resvg(svg, {
    font: {
      fontFiles,
      loadSystemFonts: true,
      defaultFontFamily: 'Segoe UI',
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
