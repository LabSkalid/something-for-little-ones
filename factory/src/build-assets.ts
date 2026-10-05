import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { readSite } from './brand.ts';
import { stampSite } from './footer.ts';
import { pngToPdf } from './pdf.ts';
import { renderCollectionPin, renderPin } from './pins.ts';
import {
  artRoot,
  pinRoot,
  printRoot,
  sheetContentRoot,
  themeContentRoot,
} from './paths.ts';

type ThemeData = {
  title: string;
  accent: string;
  pins?: { id: string; title: string; subtitle: string }[];
};

type SheetData = {
  title: string;
  slug: string;
  order: number;
};

async function walkSvg(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walkSvg(full)));
    else if (entry.name.endsWith('.svg')) files.push(full);
  }
  return files;
}

async function drawingOnly(png: Buffer) {
  const meta = await sharp(png).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const band = Math.round(width * 0.072);
  if (width < 100 || height <= band + 100) return png;
  return sharp(png).extract({ left: 0, top: 0, width, height: height - band }).png().toBuffer();
}

function readFrontmatter(raw: string) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error('Missing frontmatter');
  return parse(match[1]) as Record<string, unknown>;
}

async function svgToPng(svg: string, width: number) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: 'white' });
  return sharp(resvg.render().asPng()).png({ compressionLevel: 9 }).toBuffer();
}

export async function buildSheetAssets() {
  const site = readSite();
  const files = await walkSvg(artRoot);
  for (const file of files) {
    const theme = path.basename(path.dirname(file));
    const slug = path.basename(file, '.svg');
    const svg = await fs.readFile(file, 'utf8');
    const sheetFile = path.join(sheetContentRoot, theme, `${slug}.md`);
    let title = slug;
    try {
      title = String(readFrontmatter(await fs.readFile(sheetFile, 'utf8')).title ?? slug);
    } catch {
      title = slug;
    }
    const print = await stampSite(await svgToPng(svg, 2000));
    const preview = await sharp(print).resize({ width: 1000 }).png({ compressionLevel: 9 }).toBuffer();
    const dir = path.join(printRoot, theme);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${slug}.png`), preview);
    await fs.writeFile(path.join(dir, `${slug}-us-letter.pdf`), await pngToPdf(print, 'letter', title, site.name));
    await fs.writeFile(path.join(dir, `${slug}-a4.pdf`), await pngToPdf(print, 'a4', title, site.name));
    await fs.rm(path.join(dir, `${slug}-letter.pdf`), { force: true });
    console.log(`asset ${theme}/${slug}`);
  }
}

type PinRow = {
  filename: string;
  type: 'single' | 'collection';
  title: string;
  url: string;
};

function csvField(value: string) {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function collectionSets<T>(pages: T[]): T[][] {
  if (pages.length < 3) return [];
  if (pages.length === 3) return [pages];
  const first = pages.slice(0, 4);
  if (pages.length === 4) return [first, pages.slice(1)];
  const start = pages.length >= 8 ? 4 : pages.length - 4;
  return [first, pages.slice(start, start + 4)];
}

async function writeManifest(rows: PinRow[]) {
  const lines = ['filename,type,title,destination URL'];
  for (const row of rows) {
    lines.push([row.filename, row.type, row.title, row.url].map(csvField).join(','));
  }
  await fs.writeFile(path.join(pinRoot, 'pins.csv'), `${lines.join('\n')}\n`);
}

async function readManifest() {
  try {
    const raw = await fs.readFile(path.join(pinRoot, 'pins.csv'), 'utf8');
    const rows: PinRow[] = [];
    for (const line of raw.split(/\r?\n/).slice(1)) {
      if (!line.trim()) continue;
      const parts = line.split(',');
      if (parts.length < 4) continue;
      rows.push({
        filename: parts[0],
        type: parts[1] === 'collection' ? 'collection' : 'single',
        title: parts[2],
        url: parts.slice(3).join(','),
      });
    }
    return rows;
  } catch {
    return [];
  }
}

export async function buildPins(onlyTheme?: string) {
  await fs.mkdir(pinRoot, { recursive: true });
  const site = readSite();
  const origin = site.url.replace(/\/$/, '');
  const themes = (await fs.readdir(themeContentRoot)).filter((name) => name.endsWith('.md')).sort();
  const rows: PinRow[] = [];
  let singles = 0;
  let collections = 0;
  const skipped: string[] = [];
  console.log('pins: local composites only, no image model');
  for (const file of themes) {
    const themeId = file.replace(/\.md$/, '');
    if (onlyTheme && themeId !== onlyTheme) continue;
    const data = readFrontmatter(await fs.readFile(path.join(themeContentRoot, file), 'utf8')) as ThemeData;
    const sheetDir = path.join(sheetContentRoot, themeId);
    let sheetFiles: string[] = [];
    try {
      sheetFiles = (await fs.readdir(sheetDir)).filter((name) => name.endsWith('.md'));
    } catch {
      skipped.push(`${themeId} (no sheets)`);
      console.log(`skip ${themeId}: no sheets`);
      continue;
    }
    const sheets: SheetData[] = [];
    for (const sheetFile of sheetFiles) {
      const sheet = readFrontmatter(await fs.readFile(path.join(sheetDir, sheetFile), 'utf8')) as SheetData;
      sheets.push(sheet);
    }
    sheets.sort((a, b) => a.order - b.order);
    const pages: { slug: string; image: Buffer }[] = [];
    for (const sheet of sheets) {
      const pngPath = path.join(printRoot, themeId, `${sheet.slug}.png`);
      try {
        pages.push({ slug: sheet.slug, image: await drawingOnly(await fs.readFile(pngPath)) });
      } catch {
        console.warn(`missing preview for ${themeId}/${sheet.slug}`);
      }
    }
    if (!pages.length) {
      skipped.push(`${themeId} (no print files)`);
      console.log(`skip ${themeId}: no print files`);
      continue;
    }
    const title = data.title;
    const accent = data.accent || '#E36C1F';
    const keep = new Set<string>();
    for (const page of pages) {
      const filename = `${themeId}-${page.slug}.png`;
      const png = await renderPin({ title, accent, brand: site.name, image: page.image });
      await fs.writeFile(path.join(pinRoot, filename), png);
      keep.add(filename);
      rows.push({
        filename,
        type: 'single',
        title,
        url: `${origin}/${themeId}/${page.slug}/`,
      });
      singles += 1;
      console.log(`pin ${filename}`);
    }
    const groups = collectionSets(pages);
    if (!groups.length) {
      skipped.push(`${themeId} collection (${pages.length} sheets)`);
      console.log(`skip collection ${themeId}: ${pages.length} sheet${pages.length === 1 ? '' : 's'}`);
    }
    for (const [index, group] of groups.entries()) {
      const filename = `${themeId}-collection-${index + 1}.png`;
      const png = await renderCollectionPin({
        title,
        accent,
        brand: site.name,
        images: group.map((page) => page.image),
      });
      await fs.writeFile(path.join(pinRoot, filename), png);
      keep.add(filename);
      rows.push({
        filename,
        type: 'collection',
        title,
        url: `${origin}/${themeId}/`,
      });
      collections += 1;
      console.log(`pin ${filename}`);
    }
    const existing = await fs.readdir(pinRoot);
    for (const name of existing) {
      if (!name.endsWith('.png') || !name.startsWith(`${themeId}-`) || keep.has(name)) continue;
      await fs.rm(path.join(pinRoot, name));
      console.log(`remove old pin ${name}`);
    }
  }
  const manifest = onlyTheme ? [...(await readManifest()).filter((row) => !row.filename.startsWith(`${onlyTheme}-`)), ...rows] : rows;
  await writeManifest(manifest);
  console.log(`pins done: ${singles} single, ${collections} collection${skipped.length ? `; skipped: ${skipped.join(', ')}` : ''}`);
}

export async function buildAssets() {
  await buildSheetAssets();
  await buildPins();
}
