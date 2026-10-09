import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { siteRoot } from './paths.ts';

const fredokaWoff = path.join(
  siteRoot,
  'node_modules',
  '@fontsource',
  'fredoka',
  'files',
  'fredoka-latin-600-normal.woff',
);

const fallbacks = [
  'C:/Windows/Fonts/comic.ttf',
  'C:/Windows/Fonts/segoeuib.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
  'C:/Windows/Fonts/calibrib.ttf',
];

let cachedFredoka: string | null = null;

function woffToSfnt(woff: Buffer) {
  if (woff.toString('ascii', 0, 4) !== 'wOFF') throw new Error('Font file is not WOFF');
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
    if (data.length !== origLength) throw new Error(`Bad font table ${tag}`);
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

/** Rounded display font (Fredoka) as a TTF path for PDF / SVG. */
export function displayFontFile() {
  if (cachedFredoka && fs.existsSync(cachedFredoka)) return cachedFredoka;
  if (fs.existsSync(fredokaWoff)) {
    const ttf = woffToSfnt(fs.readFileSync(fredokaWoff));
    const dest = path.join(os.tmpdir(), 'sfl-fredoka-latin-600.ttf');
    fs.writeFileSync(dest, ttf);
    cachedFredoka = dest;
    return dest;
  }
  return fallbacks.find((file) => fs.existsSync(file)) ?? null;
}
