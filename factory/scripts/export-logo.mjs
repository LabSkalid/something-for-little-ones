import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '../../site');
const brand = 'Something for Little Ones.com';
const colors = ['#1d7ad6', '#2e9a45', '#c9a227'];
const fredokaWoff = path.join(
  siteRoot,
  'node_modules',
  '@fontsource',
  'fredoka',
  'files',
  'fredoka-latin-600-normal.woff',
);

function woffToSfnt(woff) {
  if (woff.toString('ascii', 0, 4) !== 'wOFF') throw new Error('Fredoka file is not WOFF');
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  const tables = [];
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

function xml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const ttf = woffToSfnt(fs.readFileSync(fredokaWoff));
const fontPath = path.join(os.tmpdir(), 'sfl-fredoka-latin-600.ttf');
fs.writeFileSync(fontPath, ttf);

let colorIndex = 0;
const letters = [...brand]
  .map((char) => {
    if (char === ' ') return '<tspan> </tspan>';
    const color = colors[colorIndex % colors.length];
    colorIndex += 1;
    return `<tspan fill="${color}">${xml(char)}</tspan>`;
  })
  .join('');

const fontSize = 96;
const padX = 48;
const padY = 40;
const width = 1600;
const height = 220;
const baseline = Math.round(height * 0.68);

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <text x="${width / 2}" y="${baseline}" text-anchor="middle" font-family="Fredoka" font-size="${fontSize}" font-weight="600" letter-spacing="0.3">${letters}</text>
</svg>`;

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: width },
  font: { fontFiles: [fontPath], loadSystemFonts: false, defaultFontFamily: 'Fredoka' },
  background: 'rgba(0,0,0,0)',
});
const raw = resvg.render().asPng();
const out = path.join(siteRoot, 'public', 'logo-something-for-little-ones.png');
const trimmed = await sharp(raw)
  .trim({ threshold: 1 })
  .extend({
    top: padY,
    bottom: padY,
    left: padX,
    right: padX,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();
await fs.promises.writeFile(out, trimmed);
const meta = await sharp(trimmed).metadata();
console.log(`Wrote ${out} (${meta.width}x${meta.height}, ${trimmed.length} bytes)`);
