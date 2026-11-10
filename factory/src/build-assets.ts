import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { readSite } from './brand.ts';
import { footerHeight, stampSite, stripSiteFooter } from './footer.ts';
import { pngToPdf } from './pdf.ts';
import { writePinterestCopy } from './pin-copy.ts';
import {
  type BundleOverlayColor,
  BUNDLE_OVERLAY_COLORS,
  renderCollectionPin,
  renderOverlayBundlePin,
  renderPin,
} from './pins.ts';
import {
  artRoot,
  factoryRoot,
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

/** Classic 9-grid, overlay 4-grid, or both when building bundles. */
export type CollectionBundleKind = 'classic' | 'overlay' | 'both';

export type PinBuildOptions = {
  theme?: string;
  mode?: PinMode;
  slugs?: string[];
  removeOld?: boolean;
  writeCopy?: boolean;
  keywords?: string;
  /** Title-bar color on collection pins. Empty = theme accent. */
  accent?: string;
  /** Banner title. Empty = collection title from the theme. */
  heading?: string;
  /** Which bundle style to build. Default classic (unchanged behavior). */
  collectionBundles?: CollectionBundleKind;
  /** Overlay frame color, or random with light balancing per theme run. */
  overlayColor?: BundleOverlayColor | 'random';
  /** Clear classic collection slug memory for this theme (does not delete PNG). */
  rebuildClassic?: boolean;
};

export type PinCopyOnlyOptions = {
  theme?: string;
  /** Limit to these pin filenames (e.g. fall-coloring-pages-acorn.png). */
  filenames?: string[];
  mode?: PinMode;
  /** When false (default), only fill empty pin_title / pin_description. */
  overwrite?: boolean;
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
  if (width < 100 || height < 200) return png;

  const smart = await stripSiteFooter(png);
  const smartH = (await sharp(smart).metadata()).height ?? height;
  if (smartH < height - 12) return smart;

  const band = footerHeight(width);
  if (height <= band + 100) return png;
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

/** Compact PNG for the site + JPEG for Pinterest/R2. Same 1000×1500, no extra giant copy. */
async function writePinFiles(filename: string, png: Buffer) {
  const dest = path.join(pinRoot, filename);
  const compact = await sharp(png).png({ compressionLevel: 9, palette: true }).toBuffer();
  await fs.writeFile(dest, compact);
  await sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toFile(dest.replace(/\.png$/i, '.jpg'));
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

/** One pin per 9 sheets, in list order. Leftover sheets under 9 are unused. */
function overlayBundleSets<T>(pages: T[]): T[][] {
  const groups: T[][] = [];
  for (let start = 0; start + 4 <= pages.length; start += 4) {
    groups.push(pages.slice(start, start + 4));
  }
  return groups;
}

function pickOverlayColor(
  choice: BundleOverlayColor | 'random' | undefined,
  counts: Record<BundleOverlayColor, number>,
): BundleOverlayColor {
  let picked: BundleOverlayColor;
  if (choice && choice !== 'random') picked = choice;
  else {
    const min = Math.min(...BUNDLE_OVERLAY_COLORS.map((color) => counts[color]));
    const candidates = BUNDLE_OVERLAY_COLORS.filter((color) => counts[color] === min);
    picked = candidates[Math.floor(Math.random() * candidates.length)]!;
  }
  counts[picked] += 1;
  return picked;
}

function isClassicCollectionFilename(name: string) {
  return /-collection-\d+\.png$/i.test(name);
}

function isOverlayBundleFilename(name: string) {
  return /-bundle-\d+\.png$/i.test(name);
}

function collectionSets<T>(pages: T[]): T[][] {
  const groups: T[][] = [];
  for (let start = 0; start + 9 <= pages.length; start += 9) {
    groups.push(pages.slice(start, start + 9));
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

/** Unique pin PNG basenames under pinRoot (including done/… subfolders). */
async function listPinPngFilenames(themeId?: string): Promise<string[]> {
  const prefix = themeId ? `${themeId}-` : '';
  const names = new Set<string>();
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.png') && (!prefix || entry.name.startsWith(prefix))) {
        names.add(entry.name);
      }
    }
  }
  await walk(pinRoot);
  return [...names].sort((a, b) => a.localeCompare(b));
}

function pinTypeFromFilename(filename: string, existingType?: PinRow['type']): PinRow['type'] {
  if (existingType === 'collection' || existingType === 'single') return existingType;
  return isClassicCollectionFilename(filename) || isOverlayBundleFilename(filename) ? 'collection' : 'single';
}

async function ensureManifestRow(filename: string, existing?: PinRow): Promise<PinRow> {
  if (existing) return existing;
  const themeId = themeIdFromPinFilename(filename);
  const type = pinTypeFromFilename(filename);
  let title = themeId;
  try {
    const theme = await loadThemeMeta(themeId);
    title = theme.title || title;
  } catch {
    /* keep slug as title */
  }
  const origin = readSite().url.replace(/\/$/, '');
  let url = `${origin}/${themeId}/`;
  if (type === 'single') {
    const slug = sheetSlugFromPinFilename(filename, themeId);
    if (slug) url = `${origin}/${themeId}/${slug}/`;
  }
  return {
    filename,
    type,
    title,
    url,
    pinTitle: '',
    pinDescription: '',
  };
}

function themeIdFromPinFilename(filename: string) {
  const base = filename.replace(/\.png$/i, '');
  const overlay = base.match(/^(.*)-bundle-\d+$/i);
  if (overlay) return overlay[1];
  const collection = base.match(/^(.*)-collection-\d+$/i);
  if (collection) return collection[1];
  const dash = base.lastIndexOf('-');
  // theme slugs end with -coloring-pages; sheet slug is the rest
  const match = base.match(/^(.+-coloring-pages)-(.+)$/i);
  if (match) return match[1];
  return dash === -1 ? base : base.slice(0, dash);
}

function sheetSlugFromPinFilename(filename: string, themeId: string) {
  const base = filename.replace(/\.png$/i, '');
  if (/-collection-\d+$/i.test(base) || /-bundle-\d+$/i.test(base)) return null;
  if (!base.startsWith(`${themeId}-`)) return null;
  return base.slice(themeId.length + 1);
}

async function loadThemeMeta(themeId: string) {
  const file = path.join(themeContentRoot, `${themeId}.md`);
  const data = readFrontmatter(await fs.readFile(file, 'utf8')) as ThemeData;
  return data;
}

async function loadSheetMeta(themeId: string, slug: string): Promise<SheetData | null> {
  const file = path.join(sheetContentRoot, themeId, `${slug}.md`);
  try {
    return readFrontmatter(await fs.readFile(file, 'utf8')) as SheetData;
  } catch {
    return null;
  }
}

async function buildCopyInputForRow(
  row: PinRow,
): Promise<Parameters<typeof writePinterestCopy>[0][number] | null> {
  const themeId = themeIdFromPinFilename(row.filename);
  let themeTitle = row.title;
  let themeDescription = '';
  try {
    const theme = await loadThemeMeta(themeId);
    themeTitle = theme.title || themeTitle;
    themeDescription = String(theme.description ?? '');
  } catch {
    /* keep CSV title */
  }

  if (row.type === 'collection') {
    let sheetTitle = '';
    let age = '';
    try {
      const sheets = await listPinSheets(themeId);
      sheetTitle = sheets.map((sheet) => sheet.title).join(', ');
      age = [...new Set(sheets.map((sheet) => sheet.age).filter(Boolean))].join(', ');
    } catch {
      /* optional */
    }
    return {
      filename: row.filename,
      type: 'collection',
      themeTitle,
      url: row.url,
      sheetTitle,
      sheetDescription: themeDescription,
      age,
    };
  }

  const slug = sheetSlugFromPinFilename(row.filename, themeId);
  const sheet = slug ? await loadSheetMeta(themeId, slug) : null;
  return {
    filename: row.filename,
    type: 'single',
    themeTitle,
    url: row.url,
    sheetTitle: String(sheet?.title ?? slug ?? ''),
    sheetDescription: String(sheet?.description ?? ''),
    age: String(sheet?.age ?? ''),
  };
}

/**
 * List pin PNGs for a theme (root + done/…), merged with pins.csv copy fields.
 * Orphan CSV rows without a PNG are omitted — presence of an image is the source of truth.
 */
export async function listThemePins(themeId: string) {
  const rows = await readManifest();
  const byName = new Map(
    rows.filter((row) => row.filename.startsWith(`${themeId}-`)).map((row) => [row.filename, row]),
  );
  const filenames = await listPinPngFilenames(themeId);
  const pins = [];
  for (const filename of filenames) {
    const row = byName.get(filename);
    const pinTitle = row?.pinTitle ?? '';
    const pinDescription = row?.pinDescription ?? '';
    const type = pinTypeFromFilename(filename, row?.type);
    pins.push({
      filename,
      type,
      title: row?.title ?? '',
      url: row?.url ?? '',
      pinTitle,
      pinDescription,
      hasCopy: hasPinCopy({ pinTitle, pinDescription }),
      hasImage: true,
    });
  }
  // Missing text first so Studio defaults to the work queue.
  pins.sort((a, b) => Number(a.hasCopy) - Number(b.hasCopy) || a.filename.localeCompare(b.filename));
  return pins;
}

/**
 * Write Pinterest titles/descriptions only. Does not create, rewrite, or delete pin PNGs.
 * Discovers PNGs on disk (including done/…) and adds missing pins.csv rows as needed.
 * Default: fill empty copy. Pass overwrite:true to replace existing texts.
 */
export async function writePinCopyOnly(options: PinCopyOnlyOptions = {}) {
  const onlyTheme = options.theme || undefined;
  const mode: PinMode = options.mode ?? 'both';
  const overwrite = Boolean(options.overwrite);
  const keywords = (options.keywords ?? '').trim();
  const selected = new Set((options.filenames ?? []).filter(Boolean));

  const manifest = await readManifest();
  const byName = new Map(manifest.map((row) => [row.filename, row]));
  const filenames = await listPinPngFilenames(onlyTheme);
  const targets: PinRow[] = [];

  const block = await readQueueBlock();
  for (const filename of filenames) {
    if (onlyTheme && !filename.startsWith(`${onlyTheme}-`)) continue;
    const existing = byName.get(filename);
    const type = pinTypeFromFilename(filename, existing?.type);
    const isCollection = type === 'collection';
    if (mode === 'collection' && !isCollection) continue;
    if (mode === 'single' && isCollection) continue;
    if (queueBlocked(filename, block)) {
      console.log(`pin copy: ${filename} в таблицу не идёт, текст не пишу`);
      continue;
    }
    if (selected.size && !selected.has(filename)) continue;

    const row = await ensureManifestRow(filename, existing);
    if (!existing) {
      manifest.push(row);
      byName.set(filename, row);
      console.log(`pin copy: new CSV row for ${filename}`);
    }
    if (!overwrite && hasPinCopy(row)) continue;
    targets.push(row);
  }

  if (!targets.length) {
    console.log(
      overwrite
        ? 'pin copy: nothing to write (no matching pin images)'
        : 'pin copy: nothing to write (all matching pins already have text, or no images)',
    );
    return { updated: 0, skipped: 0 };
  }

  console.log(
    `pin copy only: ${targets.length} pin(s), images untouched` +
      (overwrite ? ', overwrite existing' : ', empty fields only'),
  );

  const copyInputs: Parameters<typeof writePinterestCopy>[0] = [];
  for (const row of targets) {
    const input = await buildCopyInputForRow(row);
    if (input) copyInputs.push(input);
  }

  const chunkSize = 12;
  const copyMap = new Map<string, { pinTitle: string; pinDescription: string }>();
  for (let i = 0; i < copyInputs.length; i += chunkSize) {
    const chunk = copyInputs.slice(i, i + chunkSize);
    const part = await writePinterestCopy(chunk, keywords);
    for (const [filename, value] of part) copyMap.set(filename, value);
  }

  let updated = 0;
  for (const row of manifest) {
    const copy = copyMap.get(row.filename);
    if (!copy) continue;
    row.pinTitle = copy.pinTitle;
    row.pinDescription = copy.pinDescription;
    if (keywords) row.keywords = keywords;
    updated += 1;
  }

  await writeManifest(manifest);
  console.log(`pin copy only done: ${updated} row(s) in pins.csv`);
  console.log(`manifest: ${path.join(pinRoot, 'pins.csv')}`);
  return { updated, skipped: targets.length - updated };
}

export async function listPinSheets(themeId: string) {
  const sheetDir = path.join(sheetContentRoot, themeId);
  let sheetFiles: string[] = [];
  try {
    sheetFiles = (await fs.readdir(sheetDir)).filter((name) => name.endsWith('.md'));
  } catch {
    return [];
  }
  const existingPinNames = new Set(await listPinPngFilenames(themeId));
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
      hasPin: existingPinNames.has(`${themeId}-${slug}.png`),
    });
  }
  return sheets.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
}

function pinMatchesType(name: string, themeId: string, mode: PinMode) {
  if (!name.startsWith(`${themeId}-`)) return false;
  if (!/\.(png|jpg)$/i.test(name)) return false;
  const isBundle =
    /-collection-\d+\.(png|jpg)$/i.test(name) || /-bundle-\d+\.(png|jpg)$/i.test(name);
  if (mode === 'collection') return isBundle;
  if (mode === 'single') return !isBundle;
  return true;
}

async function removeThemePins(themeId: string, mode: PinMode) {
  async function walk(dir: string): Promise<string[]> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const found: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...(await walk(full)));
      else if (pinMatchesType(entry.name, themeId, mode)) found.push(full);
    }
    return found;
  }
  const files = await walk(pinRoot);
  let removed = 0;
  for (const file of files) {
    try {
      await fs.rm(file, { force: true });
      removed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`не удалось удалить ${path.basename(file)}: ${message}`);
    }
  }
  if (removed) console.log(`remove old pins: ${removed}`);
}

const collectionUsedFile = path.join(factoryRoot, 'scripts', 'collection-used.json');
const overlayBundleUsedFile = path.join(factoryRoot, 'scripts', 'overlay-bundle-used.json');
const queueBlockFile = path.join(factoryRoot, 'scripts', 'pin-queue-block.txt');

async function walkPinNames(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) names.push(...(await walkPinNames(path.join(dir, entry.name))));
    else names.push(entry.name);
  }
  return names;
}

async function nextCollectionIndex(themeId: string): Promise<number> {
  const names = await walkPinNames(pinRoot);
  const numbers = names
    .map((name) => name.match(new RegExp(`^${themeId}-collection-(\\d+)\\.(png|jpe?g)$`, 'i'))?.[1])
    .filter(Boolean)
    .map(Number);
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

async function pinNameExists(filename: string) {
  const want = filename.toLowerCase();
  const names = await walkPinNames(pinRoot);
  if (names.some((name) => name.toLowerCase() === want)) return true;
  return (await readShippedPins()).some((pin) => pin.filename.toLowerCase() === want);
}

type CollectionUsedEntry = { filename: string; slugs: string[] };

function classicCollectionFilenameRe(themeId: string) {
  const safe = themeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${safe}-collection-\\d+\\.(png|jpe?g)$`, 'i');
}

async function listClassicCollectionFilenames(themeId: string): Promise<string[]> {
  const names = await walkPinNames(pinRoot);
  const re = classicCollectionFilenameRe(themeId);
  return names.filter((name) => re.test(name));
}

async function clearClassicCollectionUsed(themeId: string) {
  let data: Record<string, string[] | CollectionUsedEntry[]> = {};
  try {
    data = JSON.parse(await fs.readFile(collectionUsedFile, 'utf8')) as Record<
      string,
      string[] | CollectionUsedEntry[]
    >;
  } catch {
    data = {};
  }
  delete data[themeId];
  await fs.writeFile(collectionUsedFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`${themeId}: classic учёт листов сброшен (можно собрать бандлы заново)`);
}

/** Sheets locked by existing classic collection PNG (per-file records). */
async function readUsedSlugs(themeId: string): Promise<Set<string>> {
  let data: Record<string, string[] | CollectionUsedEntry[]> = {};
  try {
    data = JSON.parse(await fs.readFile(collectionUsedFile, 'utf8')) as Record<
      string,
      string[] | CollectionUsedEntry[]
    >;
  } catch {
    return new Set();
  }
  const raw = data[themeId];
  if (!raw?.length) return new Set();

  if (typeof raw[0] === 'string') {
    const files = await listClassicCollectionFilenames(themeId);
    const legacy = raw as string[];
    if (!files.length) {
      data[themeId] = [];
      await fs.writeFile(collectionUsedFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      console.log(`${themeId}: classic учёт сброшен — collection PNG на диске нет`);
      return new Set();
    }
    const cap = files.length * 9;
    if (legacy.length > cap) {
      console.log(
        `${themeId}: в учёте classic ${legacy.length} листов, а файлов collection — ${files.length}; ` +
          `держим только первые ${cap}. Для полного сброса включите «Пересобрать classic».`,
      );
      return new Set(legacy.slice(0, cap));
    }
    return new Set(legacy);
  }

  const used = new Set<string>();
  const kept: CollectionUsedEntry[] = [];
  for (const rec of raw as CollectionUsedEntry[]) {
    if (await pinNameExists(rec.filename)) {
      kept.push(rec);
      for (const slug of rec.slugs) used.add(slug);
    }
  }
  if (kept.length !== (raw as CollectionUsedEntry[]).length) {
    data[themeId] = kept;
    await fs.writeFile(collectionUsedFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    console.log(`${themeId}: classic учёт подчистил записи без файла`);
  }
  return used;
}

async function addUsedSlugs(themeId: string, filename: string, slugs: string[]) {
  let data: Record<string, string[] | CollectionUsedEntry[]> = {};
  try {
    data = JSON.parse(await fs.readFile(collectionUsedFile, 'utf8')) as Record<
      string,
      string[] | CollectionUsedEntry[]
    >;
  } catch {
    data = {};
  }
  const raw = data[themeId];
  let records: CollectionUsedEntry[] = [];
  if (raw?.length && typeof raw[0] === 'object' && raw[0] !== null && 'filename' in raw[0]) {
    records = [...(raw as CollectionUsedEntry[])];
  }
  records = records.filter((entry) => entry.filename !== filename);
  records.push({ filename, slugs });
  data[themeId] = records;
  await fs.writeFile(collectionUsedFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

type OverlayBundleUsedEntry = { filename: string; slugs: string[] };

function overlayBundleFilenameRe(themeId: string) {
  const safe = themeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${safe}-bundle-\\d+\\.(png|jpe?g)$`, 'i');
}

async function listOverlayBundleFilenames(themeId: string): Promise<string[]> {
  const names = await walkPinNames(pinRoot);
  const re = overlayBundleFilenameRe(themeId);
  return names.filter((name) => re.test(name));
}

/** Sheets locked only while the matching -bundle-*.png still exists on disk. */
async function readOverlayUsedSlugs(themeId: string): Promise<Set<string>> {
  let data: Record<string, string[] | OverlayBundleUsedEntry[]> = {};
  try {
    data = JSON.parse(await fs.readFile(overlayBundleUsedFile, 'utf8')) as Record<
      string,
      string[] | OverlayBundleUsedEntry[]
    >;
  } catch {
    return new Set();
  }
  const raw = data[themeId];
  if (!raw?.length) return new Set();

  if (typeof raw[0] === 'string') {
    const bundleFiles = await listOverlayBundleFilenames(themeId);
    if (!bundleFiles.length) {
      data[themeId] = [];
      await fs.writeFile(overlayBundleUsedFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      console.log(`${themeId}: overlay учёт сброшен — bundle PNG на диске нет`);
      return new Set();
    }
    return new Set(raw as string[]);
  }

  const used = new Set<string>();
  const kept: OverlayBundleUsedEntry[] = [];
  for (const rec of raw as OverlayBundleUsedEntry[]) {
    if (await pinNameExists(rec.filename)) {
      kept.push(rec);
      for (const slug of rec.slugs) used.add(slug);
    }
  }
  if (kept.length !== (raw as OverlayBundleUsedEntry[]).length) {
    data[themeId] = kept;
    await fs.writeFile(overlayBundleUsedFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    console.log(`${themeId}: overlay учёт подчистил записи без файла`);
  }
  return used;
}

async function addOverlayUsedSlugs(themeId: string, filename: string, slugs: string[]) {
  let data: Record<string, string[] | OverlayBundleUsedEntry[]> = {};
  try {
    data = JSON.parse(await fs.readFile(overlayBundleUsedFile, 'utf8')) as Record<
      string,
      string[] | OverlayBundleUsedEntry[]
    >;
  } catch {
    data = {};
  }
  const raw = data[themeId];
  let records: OverlayBundleUsedEntry[] = [];
  if (raw?.length && typeof raw[0] === 'object' && raw[0] !== null && 'filename' in raw[0]) {
    records = [...(raw as OverlayBundleUsedEntry[])];
  }
  records = records.filter((entry) => entry.filename !== filename);
  records.push({ filename, slugs });
  data[themeId] = records;
  await fs.writeFile(overlayBundleUsedFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function nextOverlayBundleIndex(themeId: string): Promise<number> {
  const names = await walkPinNames(pinRoot);
  const numbers = names
    .map((name) => name.match(new RegExp(`^${themeId}-bundle-(\\d+)\\.(png|jpe?g)$`, 'i'))?.[1])
    .filter(Boolean)
    .map(Number);
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

/** Filenames that must never be copied into the Make sheet. */
export async function readQueueBlock(): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(queueBlockFile, 'utf8');
    return new Set(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase())
        .filter((line) => line && !line.startsWith('#')),
    );
  } catch {
    return new Set();
  }
}

export function queueBlocked(filename: string, block: Set<string>) {
  const lower = filename.toLowerCase();
  const asPng = lower.replace(/\.jpe?g$/, '.png');
  return block.has(lower) || block.has(asPng);
}

/** Pins already sent to the Make sheet. Files may be deleted; these names and sheets stay used. */
const shippedPinsFile = path.join(factoryRoot, 'scripts', 'pins-shipped.json');

export type ShippedPin = {
  filename: string;
  kind: 'classic' | 'overlay' | 'single';
  slugs: string[];
};

function shippedKind(filename: string): ShippedPin['kind'] {
  if (/-bundle-\d+\.png$/i.test(filename)) return 'overlay';
  if (/-collection-\d+\.png$/i.test(filename)) return 'classic';
  return 'single';
}

export async function readShippedPins(): Promise<ShippedPin[]> {
  try {
    const data = JSON.parse(await fs.readFile(shippedPinsFile, 'utf8')) as ShippedPin[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function slugsRecordedFor(filename: string, kind: ShippedPin['kind']): Promise<string[]> {
  if (kind === 'single') {
    const themeId = themeIdFromPinFilename(filename);
    const slug = sheetSlugFromPinFilename(filename, themeId);
    return slug ? [slug] : [];
  }
  const file = kind === 'classic' ? collectionUsedFile : overlayBundleUsedFile;
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf8')) as Record<
      string,
      string[] | { filename: string; slugs: string[] }[]
    >;
    const themeId = themeIdFromPinFilename(filename);
    const raw = data[themeId];
    if (!raw?.length || typeof raw[0] === 'string') return [];
    const hit = (raw as { filename: string; slugs: string[] }[]).find(
      (entry) => entry.filename.toLowerCase() === filename.toLowerCase(),
    );
    return hit?.slugs ?? [];
  } catch {
    return [];
  }
}

/** Call after the sheet accepts a batch. Hand-deleted pins never get here. */
export async function rememberShippedPins(filenames: string[]) {
  const byName = new Map((await readShippedPins()).map((pin) => [pin.filename.toLowerCase(), pin]));
  let added = 0;
  for (const raw of filenames) {
    const filename = String(raw ?? '').trim().replace(/\.jpe?g$/i, '.png');
    if (!filename) continue;
    const key = filename.toLowerCase();
    if (byName.has(key)) continue;
    const kind = shippedKind(filename);
    byName.set(key, { filename, kind, slugs: await slugsRecordedFor(filename, kind) });
    added += 1;
  }
  if (!added) return added;
  await fs.writeFile(shippedPinsFile, `${JSON.stringify([...byName.values()], null, 2)}\n`, 'utf8');
  console.log(`Запомнила в списке таблицы: ${added} пин(ов). Кнопка «Убрать с диска» сможет их стереть, заново они не соберутся.`);
  return added;
}

export async function shippedSlugSet(themeId: string, kind: 'classic' | 'overlay'): Promise<Set<string>> {
  const slugs = new Set<string>();
  for (const pin of await readShippedPins()) {
    if (pin.kind !== kind) continue;
    if (!pin.filename.toLowerCase().startsWith(`${themeId.toLowerCase()}-`)) continue;
    for (const slug of pin.slugs) slugs.add(slug);
  }
  return slugs;
}

/** Delete local PNG/JPG of pins already sent to the sheet. Leaves unsent pins and done/. */
export async function removeShippedLocalFiles() {
  const shipped = await readShippedPins();
  if (!shipped.length) {
    console.log(
      'Убирать нечего. Сначала нажмите «В таблицу» — фабрика запоминает только те пины, которые реально ушли в таблицу. Остальные, и те что вы удалили руками, не трогаю.',
    );
    return { removed: 0, keptPreview: 0 };
  }
  let removed = 0;
  let keptPreview = 0;
  for (const pin of shipped) {
    const pngName = pin.filename.replace(/\.jpe?g$/i, '.png');
    const jpgName = pngName.replace(/\.png$/i, '.jpg');
    const keepPng = /-collection-1\.png$/i.test(pngName);
    if (keepPng) keptPreview += 1;
    for (const name of keepPng ? [jpgName] : [pngName, jpgName]) {
      const file = path.join(pinRoot, name);
      try {
        await fs.access(file);
      } catch {
        continue;
      }
      await fs.rm(file);
      removed += 1;
      console.log(`убрала с диска: ${name}`);
    }
  }
  console.log(
    removed
      ? `Готово. С диска убрано файлов: ${removed}. Пины, которых ещё нет в таблице, на месте.`
      : 'Эти пины с диска уже убраны. Пины вне таблицы не трогала.',
  );
  if (keptPreview) {
    console.log(`Картинку темы для сайта (collection-1) оставила, штук: ${keptPreview}.`);
  }
  return { removed, keptPreview };
}

export async function buildPins(themeOrOptions?: string | PinBuildOptions) {
  const options: PinBuildOptions =
    typeof themeOrOptions === 'string' || themeOrOptions === undefined
      ? { theme: themeOrOptions, mode: 'both', removeOld: true, writeCopy: false }
      : themeOrOptions;

  const mode: PinMode = options.mode ?? 'both';
  const onlyTheme = options.theme || undefined;
  const selected = new Set((options.slugs ?? []).filter(Boolean));
  const removeOld = Boolean(options.removeOld);
  const writeCopy = Boolean(options.writeCopy);
  const keywords = (options.keywords ?? '').trim();
  const collectionBundles: CollectionBundleKind = options.collectionBundles ?? 'classic';
  const overlayColorChoice = options.overlayColor ?? 'random';
  const buildClassic =
    (mode === 'collection' || mode === 'both') &&
    (collectionBundles === 'classic' || collectionBundles === 'both');
  const buildOverlay =
    (mode === 'collection' || mode === 'both') &&
    (collectionBundles === 'overlay' || collectionBundles === 'both');

  await fs.mkdir(pinRoot, { recursive: true });
  const site = readSite();
  const origin = site.url.replace(/\/$/, '');
  const themes = (await fs.readdir(themeContentRoot)).filter((name) => name.endsWith('.md')).sort();
  const rows: PinRow[] = [];
  const copyInputs: Parameters<typeof writePinterestCopy>[0] = [];
  let singles = 0;
  let collections = 0;
  let overlayBundles = 0;
  const skipped: string[] = [];
  const overlayColorCounts = Object.fromEntries(
    BUNDLE_OVERLAY_COLORS.map((color) => [color, 0]),
  ) as Record<BundleOverlayColor, number>;
  console.log(
    `pins: local composites only, no image model; mode=${mode}` +
      (buildClassic ? '; classic 9-grid' : '') +
      (buildOverlay ? `; overlay 4-grid (color=${overlayColorChoice})` : '') +
      (writeCopy ? '; Pinterest copy via text model' : ''),
  );

  for (const file of themes) {
    const themeId = file.replace(/\.md$/, '');
    if (onlyTheme && themeId !== onlyTheme) continue;
    // Collection files are never deleted. A published pin keeps its filename.
    if (removeOld && (mode === 'single' || mode === 'both')) await removeThemePins(themeId, 'single');
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
    const heading = String(options.heading ?? '').trim() || title;
    const override = String(options.accent ?? '').trim();
    const accent = /^#[0-9a-fA-F]{6}$/.test(override) ? override : data.accent || '#1d7ad6';
    const themeRows: PinRow[] = [];
    const existingPinNames = new Set(await listPinPngFilenames(themeId));

    const shippedNames = new Set((await readShippedPins()).map((pin) => pin.filename.toLowerCase()));
    if (mode === 'single' || mode === 'both') {
      for (const page of pages) {
        const filename = `${themeId}-${page.slug}.png`;
        if (shippedNames.has(filename.toLowerCase())) {
          console.log(`skip ${filename}: уже в таблице`);
          continue;
        }
        if (selected.size && existingPinNames.has(filename)) {
          console.log(`skip existing pin ${filename}`);
          continue;
        }
        const png = await renderPin({ title, accent, brand: site.name, image: page.image });
        await writePinFiles(filename, png);
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

    if (buildClassic) {
      if (options.rebuildClassic) await clearClassicCollectionUsed(themeId);
      const used = await readUsedSlugs(themeId);
      for (const slug of await shippedSlugSet(themeId, 'classic')) used.add(slug);
      const fresh = pages.filter((page) => !used.has(page.slug));
      const already = pages.length - fresh.length;
      if (already) console.log(`${themeId}: ${already} лист(ов) уже в classic-бандле, заново не собираю`);
      const groups = collectionSets(fresh);
      if (!groups.length) {
        skipped.push(`${themeId} collection (${fresh.length} new sheets)`);
        console.log(`skip collection ${themeId}: need 9 new sheets, have ${fresh.length}`);
      } else if (fresh.length % 9) {
        console.log(`${themeId}: ${fresh.length % 9} leftover sheet(s) not used (need groups of 9)`);
      }
      let nextCollectionNumber = await nextCollectionIndex(themeId);
      for (const group of groups) {
        let filename = `${themeId}-collection-${nextCollectionNumber}.png`;
        while (await pinNameExists(filename)) {
          nextCollectionNumber += 1;
          filename = `${themeId}-collection-${nextCollectionNumber}.png`;
        }
        nextCollectionNumber += 1;
        const png = await renderCollectionPin({
          title: heading,
          accent,
          brand: site.name,
          images: group.map((page) => page.image),
        });
        await writePinFiles(filename, png);
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
        await addUsedSlugs(themeId, filename, group.map((page) => page.slug));
        console.log(`pin ${filename}`);
      }
    }

    if (buildOverlay) {
      const used = await readOverlayUsedSlugs(themeId);
      for (const slug of await shippedSlugSet(themeId, 'overlay')) used.add(slug);
      const fresh = pages.filter((page) => !used.has(page.slug));
      const already = pages.length - fresh.length;
      if (already)
        console.log(`${themeId}: ${already} лист(ов) уже в overlay-бандле (4-up), заново не собираю`);
      const groups = overlayBundleSets(fresh);
      if (!groups.length) {
        skipped.push(`${themeId} overlay bundle (${fresh.length} new sheets)`);
        console.log(`skip overlay bundle ${themeId}: need 4 new sheets, have ${fresh.length}`);
      } else if (fresh.length % 4) {
        console.log(`${themeId}: ${fresh.length % 4} leftover sheet(s) not used (need groups of 4)`);
      }
      let nextBundleNumber = await nextOverlayBundleIndex(themeId);
      for (const group of groups) {
        let filename = `${themeId}-bundle-${nextBundleNumber}.png`;
        while (await pinNameExists(filename)) {
          nextBundleNumber += 1;
          filename = `${themeId}-bundle-${nextBundleNumber}.png`;
        }
        const overlay = pickOverlayColor(overlayColorChoice, overlayColorCounts);
        nextBundleNumber += 1;
        const png = await renderOverlayBundlePin({
          images: group.map((page) => page.image),
          overlay,
        });
        await writePinFiles(filename, png);
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
        overlayBundles += 1;
        await addOverlayUsedSlugs(themeId, filename, group.map((page) => page.slug));
        console.log(`pin ${filename} (overlay ${overlay})`);
      }
    }

    rows.push(...themeRows);

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

  const block = await readQueueBlock();
  const needCopy = copyInputs.filter((item) => {
    if (queueBlocked(item.filename, block)) return false;
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

  const rebuilt = new Set(rows.map((row) => row.filename));
  const manifest = previous
    .filter((row) => {
      const themeId = onlyTheme;
      if (themeId && !row.filename.startsWith(`${themeId}-`)) return true;
      if (!themeId && mode === 'both') return false;
      const isClassic = isClassicCollectionFilename(row.filename);
      const isOverlay = isOverlayBundleFilename(row.filename);
      const isBundle = isClassic || isOverlay;
      if ((mode === 'collection' || mode === 'both') && isBundle) {
        if (buildClassic && buildOverlay) return !rebuilt.has(row.filename);
        if (buildClassic && isClassic) return !rebuilt.has(row.filename);
        if (buildOverlay && isOverlay) return !rebuilt.has(row.filename);
        return true;
      }
      if ((mode === 'single' || mode === 'both') && !isBundle) {
        if (removeOld || !selected.size) return false;
        return !rebuilt.has(row.filename);
      }
      return true;
    })
    .concat(rows);
  await writeManifest(manifest);
  if (overlayBundles) {
    console.log(
      `overlay colors: ${BUNDLE_OVERLAY_COLORS.map((color) => `${color}=${overlayColorCounts[color]}`).join(', ')}`,
    );
  }
  console.log(
    `pins done: ${singles} single, ${collections} classic collection, ${overlayBundles} overlay bundle` +
      (skipped.length ? `; skipped: ${skipped.join(', ')}` : ''),
  );
  console.log(`manifest: ${path.join(pinRoot, 'pins.csv')}`);
}

export async function buildAssets() {
  await buildSheetAssets();
  await buildPins({ mode: 'both', removeOld: true, writeCopy: false });
}
