import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { readSite } from './brand.ts';
import { stampSite } from './footer.ts';
import { pngToPdf } from './pdf.ts';
import { writePinterestCopy } from './pin-copy.ts';
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
  description?: string;
  accent: string;
  pins?: { id: string; title: string; subtitle: string }[];
};

type SheetData = {
  title: string;
  slug: string;
  order: number;
  description?: string;
  age?: string;
};

export type PinMode = 'collection' | 'single' | 'both';

export type PinBuildOptions = {
  theme?: string;
  mode?: PinMode;
  slugs?: string[];
  collectionCount?: number;
  removeOld?: boolean;
  writeCopy?: boolean;
  keywords?: string;
};

type PinRow = {
  filename: string;
  type: 'single' | 'collection';
  title: string;
  url: string;
  pinTitle?: string;
  pinDescription?: string;
  keywords?: string;
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

function csvField(value: string) {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

/** Parse a whole CSV (supports quoted fields with newlines). */
function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"' && raw[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur);
      cur = '';
      if (row.some((cell) => cell.length)) rows.push(row);
      row = [];
    } else if (ch !== '\r') {
      cur += ch;
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    if (row.some((cell) => cell.length)) rows.push(row);
  }
  return rows;
}

function hasPinCopy(row: Pick<PinRow, 'pinTitle' | 'pinDescription'>) {
  return Boolean(row.pinTitle?.trim() && row.pinDescription?.trim());
}

/** Split selected pages into bundles of up to 4. Walks through the list in order. */
function collectionSets<T>(pages: T[], maxGroups = 2): T[][] {
  if (pages.length < 3) return [];
  const groups: T[][] = [];
  let start = 0;
  while (start < pages.length && groups.length < maxGroups) {
    const remaining = pages.length - start;
    if (remaining < 3) break;
    const size = Math.min(4, remaining);
    // Prefer not to leave a dangling 1–2 pages: if 5 left, take 3 then stop next loop; if 6–7 take 4.
    const take = remaining === 5 ? 3 : size;
    groups.push(pages.slice(start, start + take));
    start += take;
  }
  return groups;
}

async function writeManifest(rows: PinRow[]) {
  const lines = ['filename,type,theme_title,destination URL,pin_title,pin_description,keywords'];
  for (const row of rows) {
    lines.push(
      [
        row.filename,
        row.type,
        row.title,
        row.url,
        row.pinTitle ?? '',
        row.pinDescription ?? '',
        row.keywords ?? '',
      ]
        .map(csvField)
        .join(','),
    );
  }
  await fs.writeFile(path.join(pinRoot, 'pins.csv'), `${lines.join('\n')}\n`);
}

async function readManifest() {
  try {
    const raw = await fs.readFile(path.join(pinRoot, 'pins.csv'), 'utf8');
    const rows: PinRow[] = [];
    for (const parts of parseCsv(raw).slice(1)) {
      if (parts.length < 4 || !parts[0]) continue;
      rows.push({
        filename: parts[0],
        type: parts[1] === 'collection' ? 'collection' : 'single',
        title: parts[2],
        url: parts[3],
        pinTitle: parts[4] ?? '',
        pinDescription: parts[5] ?? '',
        keywords: parts[6] ?? '',
      });
    }
    return rows;
  } catch {
    return [];
  }
}

export async function listPinSheets(themeId: string) {
  const sheetDir = path.join(sheetContentRoot, themeId);
  let sheetFiles: string[] = [];
  try {
    sheetFiles = (await fs.readdir(sheetDir)).filter((name) => name.endsWith('.md'));
  } catch {
    return [];
  }
  const sheets = [];
  for (const sheetFile of sheetFiles) {
    const sheet = readFrontmatter(await fs.readFile(path.join(sheetDir, sheetFile), 'utf8')) as SheetData;
    const slug = String(sheet.slug ?? sheetFile.replace(/\.md$/, ''));
    let hasPrint = false;
    try {
      await fs.access(path.join(printRoot, themeId, `${slug}.png`));
      hasPrint = true;
    } catch {
      hasPrint = false;
    }
    sheets.push({
      slug,
      title: String(sheet.title ?? slug),
      age: String(sheet.age ?? ''),
      order: Number(sheet.order ?? 0),
      description: String(sheet.description ?? ''),
      hasPrint,
    });
  }
  return sheets.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
}

export async function buildPins(themeOrOptions?: string | PinBuildOptions) {
  const options: PinBuildOptions =
    typeof themeOrOptions === 'string' || themeOrOptions === undefined
      ? { theme: themeOrOptions, mode: 'both', removeOld: true, writeCopy: false }
      : themeOrOptions;

  const mode: PinMode = options.mode ?? 'both';
  const onlyTheme = options.theme || undefined;
  const selected = new Set((options.slugs ?? []).filter(Boolean));
  const collectionCount = Math.max(1, Math.min(40, options.collectionCount ?? 2));
  const removeOld = Boolean(options.removeOld);
  const writeCopy = Boolean(options.writeCopy);
  const keywords = (options.keywords ?? '').trim();

  await fs.mkdir(pinRoot, { recursive: true });
  const site = readSite();
  const origin = site.url.replace(/\/$/, '');
  const themes = (await fs.readdir(themeContentRoot)).filter((name) => name.endsWith('.md')).sort();
  const rows: PinRow[] = [];
  const copyInputs: Parameters<typeof writePinterestCopy>[0] = [];
  let singles = 0;
  let collections = 0;
  const skipped: string[] = [];
  console.log(
    `pins: local composites only, no image model; mode=${mode}` +
      (writeCopy ? '; Pinterest copy via text model' : ''),
  );

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
    type Page = { slug: string; image: Buffer; title: string; description: string; age: string };
    const pages: Page[] = [];
    for (const sheet of sheets) {
      const slug = String(sheet.slug ?? '');
      if (!slug) continue;
      if (selected.size && !selected.has(slug)) continue;
      const pngPath = path.join(printRoot, themeId, `${slug}.png`);
      try {
        pages.push({
          slug,
          image: await drawingOnly(await fs.readFile(pngPath)),
          title: String(sheet.title ?? slug),
          description: String(sheet.description ?? ''),
          age: String(sheet.age ?? ''),
        });
      } catch {
        console.warn(`missing preview for ${themeId}/${slug}`);
      }
    }
    if (!pages.length) {
      skipped.push(`${themeId} (no print files)`);
      console.log(`skip ${themeId}: no print files`);
      continue;
    }

    const title = data.title;
    const accent = data.accent || '#1d7ad6';
    const keep = new Set<string>();
    const themeRows: PinRow[] = [];

    if (mode === 'single' || mode === 'both') {
      for (const page of pages) {
        const filename = `${themeId}-${page.slug}.png`;
        const png = await renderPin({ title, accent, brand: site.name, image: page.image });
        await fs.writeFile(path.join(pinRoot, filename), png);
        keep.add(filename);
        const url = `${origin}/${themeId}/${page.slug}/`;
        themeRows.push({ filename, type: 'single', title, url });
        copyInputs.push({
          filename,
          type: 'single',
          themeTitle: title,
          url,
          sheetTitle: page.title,
          sheetDescription: page.description,
          age: page.age,
        });
        singles += 1;
        console.log(`pin ${filename}`);
      }
    }

    if (mode === 'collection' || mode === 'both') {
      const groups = collectionSets(pages, collectionCount);
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
        const url = `${origin}/${themeId}/`;
        themeRows.push({ filename, type: 'collection', title, url });
        copyInputs.push({
          filename,
          type: 'collection',
          themeTitle: title,
          url,
          sheetTitle: group.map((page) => page.title).join(', '),
          sheetDescription: data.description ?? '',
          age: [...new Set(group.map((page) => page.age).filter(Boolean))].join(', '),
        });
        collections += 1;
        console.log(`pin ${filename}`);
      }
    }

    rows.push(...themeRows);

    if (removeOld) {
      const existing = await fs.readdir(pinRoot);
      for (const name of existing) {
        if (!name.endsWith('.png') || !name.startsWith(`${themeId}-`)) continue;
        const isCollection = /-collection-\d+\.png$/i.test(name);
        if (mode === 'collection' && !isCollection) continue;
        if (mode === 'single' && isCollection) continue;
        if (keep.has(name)) continue;
        await fs.rm(path.join(pinRoot, name));
        console.log(`remove old pin ${name}`);
      }
    }
  }

  // Keep paid/written Pinterest copy when only the pin image is rebuilt.
  const previous = await readManifest();
  const previousByName = new Map(previous.map((row) => [row.filename, row]));
  let keptCopy = 0;
  for (const row of rows) {
    const old = previousByName.get(row.filename);
    if (!old || !hasPinCopy(old)) continue;
    row.pinTitle = old.pinTitle;
    row.pinDescription = old.pinDescription;
    row.keywords = old.keywords || keywords || row.keywords;
    keptCopy += 1;
  }
  if (keptCopy) console.log(`pin copy kept: ${keptCopy} existing texts`);

  const needCopy = copyInputs.filter((item) => {
    const row = rows.find((r) => r.filename === item.filename);
    return row ? !hasPinCopy(row) : true;
  });

  if (writeCopy && needCopy.length) {
    console.log(`pin copy: ${needCopy.length} new texts via cheap text model (skipping ones that already exist)`);
    try {
      // Chunk to keep prompts small.
      const chunkSize = 12;
      const copyMap = new Map<string, { pinTitle: string; pinDescription: string }>();
      for (let i = 0; i < needCopy.length; i += chunkSize) {
        const chunk = needCopy.slice(i, i + chunkSize);
        const part = await writePinterestCopy(chunk, keywords);
        for (const [filename, value] of part) copyMap.set(filename, value);
      }
      for (const row of rows) {
        if (hasPinCopy(row)) continue;
        const copy = copyMap.get(row.filename);
        if (!copy) continue;
        row.pinTitle = copy.pinTitle;
        row.pinDescription = copy.pinDescription;
        row.keywords = keywords;
      }
      console.log(`pin copy done: ${copyMap.size}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`pin copy failed: ${message}`);
      console.log('Картинки пинов уже сохранены. Текст можно дописать позже.');
    }
  } else if (writeCopy && !needCopy.length) {
    console.log('pin copy: nothing new to write, all rebuilt pins already have text');
  }

  let manifest: PinRow[];
  if (onlyTheme) {
    const kept = previous.filter((row) => {
      if (!row.filename.startsWith(`${onlyTheme}-`)) return true;
      const isCollection = /-collection-\d+\.png$/i.test(row.filename);
      if (mode === 'collection' && !isCollection) return true;
      if (mode === 'single' && isCollection) return true;
      // Replace rows for the types we rebuilt.
      return false;
    });
    manifest = [...kept, ...rows];
  } else if (mode === 'both' && !selected.size) {
    // Full rebuild still keeps any previous copy for matching filenames above.
    manifest = rows;
  } else {
    const rebuilt = new Set(rows.map((row) => row.filename));
    manifest = [...previous.filter((row) => !rebuilt.has(row.filename)), ...rows];
  }
  await writeManifest(manifest);
  console.log(
    `pins done: ${singles} single, ${collections} collection` +
      (skipped.length ? `; skipped: ${skipped.join(', ')}` : ''),
  );
  console.log(`manifest: ${path.join(pinRoot, 'pins.csv')}`);
}

export async function buildAssets() {
  await buildSheetAssets();
  await buildPins({ mode: 'both', removeOld: true, writeCopy: false });
}
