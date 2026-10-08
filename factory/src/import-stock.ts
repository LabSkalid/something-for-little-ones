import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { parse } from 'yaml';
import { readSite } from './brand.ts';
import { footerHeight, stampSite } from './footer.ts';
import { loadEnv } from './env.ts';
import { visionChat } from './openrouter.ts';
import { pngToPdf } from './pdf.ts';
import { factoryRoot, printRoot, sheetContentRoot, themeContentRoot } from './paths.ts';

/** Write through a temp file + retries — Windows often locks PDFs (Defender / preview). */
async function writeFileSafe(dest: string, data: Buffer | string) {
  const dir = path.dirname(dest);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(
    os.tmpdir(),
    `sfl-write-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(dest)}`,
  );
  await fs.writeFile(tmp, data);
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fs.copyFile(tmp, dest);
      await fs.unlink(tmp).catch(() => undefined);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  await fs.unlink(tmp).catch(() => undefined);
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Не удалось записать ${dest}: ${message}`);
}

export const AGE_BANDS = ['2-3', '3-4', '4-5', '5-6', '6-8'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);

const difficulty: Record<AgeBand, string> = {
  '2-3': 'toddler',
  '3-4': 'easy',
  '4-5': 'medium',
  '5-6': 'medium',
  '6-8': 'detailed',
};

export type DraftSheet = {
  id: string;
  file: string;
  age: AgeBand;
  slug: string;
  title: string;
  description: string;
  alt: string;
  parentNote: string;
  include: boolean;
  thumb: string;
};

function q(value: string) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/coloring pages?/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function titleCase(slug: string) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function ageFromPath(file: string, root: string): AgeBand | null {
  const rel = path.relative(root, path.dirname(file));
  const parts = rel.split(/[/\\]/).map((part) => part.trim().toLowerCase());
  for (const part of parts) {
    const match = part.match(/^(2-3|3-4|4-5|5-6|6-8)$/);
    if (match) return match[1] as AgeBand;
    const spaced = part.replace(/\s+/g, '');
    if (AGE_BANDS.includes(spaced as AgeBand)) return spaced as AgeBand;
  }
  return null;
}

async function walkImages(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      files.push(...(await walkImages(full)));
      continue;
    }
    if (IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
  return files;
}

async function renderSvg(file: string) {
  const svg = await fs.readFile(file, 'utf8');
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 2000 }, background: 'white' }).render().asPng();
  return sharp(png).flatten({ background: '#ffffff' }).png().toBuffer();
}

async function loadRaster(file: string) {
  return sharp(file).flatten({ background: '#ffffff' }).png().toBuffer();
}

function edgeDarkRatio(
  data: Buffer,
  width: number,
  height: number,
  side: 'top' | 'bottom' | 'left' | 'right',
  inset: number,
) {
  let dark = 0;
  let total = 0;
  const isDark = (value: number) => value < 56;
  if (side === 'top' || side === 'bottom') {
    const y = side === 'top' ? inset : height - 1 - inset;
    if (y < 0 || y >= height) return 0;
    for (let x = 0; x < width; x += 1) {
      if (isDark(data[y * width + x])) dark += 1;
      total += 1;
    }
  } else {
    const x = side === 'left' ? inset : width - 1 - inset;
    if (x < 0 || x >= width) return 0;
    for (let y = 0; y < height; y += 1) {
      if (isDark(data[y * width + x])) dark += 1;
      total += 1;
    }
  }
  return total ? dark / total : 0;
}

function findDarkBand(
  data: Buffer,
  width: number,
  height: number,
  side: 'top' | 'bottom' | 'left' | 'right',
  maxScan: number,
) {
  for (let i = 0; i < maxScan; i += 1) {
    if (edgeDarkRatio(data, width, height, side, i) < 0.5) continue;
    let thickness = 1;
    while (
      i + thickness < maxScan &&
      edgeDarkRatio(data, width, height, side, i + thickness) >= 0.4
    ) {
      thickness += 1;
    }
    return { pos: i, thickness };
  }
  return null;
}

/** Crop away a stock square frame (black border around the drawing) when present. */
async function stripOuterFrame(image: Buffer) {
  let working = await sharp(image).flatten({ background: '#ffffff' }).png().toBuffer();
  try {
    working = await sharp(working).trim({ background: '#ffffff', threshold: 16 }).png().toBuffer();
  } catch {
    // already tight
  }

  const { data, info } = await sharp(working).grayscale().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  if (width < 80 || height < 80) return working;

  // Stock frames often sit 1–few px inside the trimmed box (a white hairline outside).
  const maxScan = Math.max(8, Math.min(70, Math.floor(Math.min(width, height) * 0.12)));
  const top = findDarkBand(data, width, height, 'top', maxScan);
  const bottom = findDarkBand(data, width, height, 'bottom', maxScan);
  const left = findDarkBand(data, width, height, 'left', maxScan);
  const right = findDarkBand(data, width, height, 'right', maxScan);
  if (!top || !bottom || !left || !right) return working;

  // Ignore random dark strokes deep inside the art — frame hugs the outer edge.
  const edgeLimit = Math.max(6, Math.floor(Math.min(width, height) * 0.06));
  if (top.pos > edgeLimit || bottom.pos > edgeLimit || left.pos > edgeLimit || right.pos > edgeLimit) {
    return working;
  }

  const pad = 3;
  const cropLeft = left.pos + left.thickness + pad;
  const cropTop = top.pos + top.thickness + pad;
  const cropRight = right.pos + right.thickness + pad;
  const cropBottom = bottom.pos + bottom.thickness + pad;
  const cropW = width - cropLeft - cropRight;
  const cropH = height - cropTop - cropBottom;
  if (cropW < 40 || cropH < 40) return working;

  return sharp(working)
    .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
    .png()
    .toBuffer();
}

/** Place the drawing on a US Letter white page, centered, filling the printable area. */
export async function fitOnLetter(image: Buffer) {
  const letterW = 2550;
  const letterH = 3300;
  const margin = 120;
  const maxW = letterW - margin * 2;
  const maxH = letterH - margin * 2;

  let art = await stripOuterFrame(image);
  try {
    art = await sharp(art).trim({ background: '#ffffff', threshold: 14 }).png().toBuffer();
  } catch {
    // keep as-is
  }
  art = await sharp(art)
    .extend({ top: 24, bottom: 24, left: 24, right: 24, background: '#ffffff' })
    .resize(maxW, maxH, { fit: 'inside', background: '#ffffff' })
    .png()
    .toBuffer();

  const meta = await sharp(art).metadata();
  const left = Math.max(0, Math.round((letterW - (meta.width ?? 0)) / 2));
  const top = Math.max(0, Math.round((letterH - (meta.height ?? 0)) / 2));
  return sharp({
    create: { width: letterW, height: letterH, channels: 3, background: '#ffffff' },
  })
    .composite([{ input: art, left, top }])
    .png()
    .toBuffer();
}

export async function loadSourceImage(file: string) {
  const ext = path.extname(file).toLowerCase();
  const raw = ext === '.svg' ? await renderSvg(file) : await loadRaster(file);
  return fitOnLetter(raw);
}

function frontmatter(raw: string) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  return parse(match[1]) as Record<string, unknown>;
}

function defaultCopy(slug: string, age: AgeBand) {
  const name = titleCase(slug) || 'Coloring';
  const ages = age.replace('-', ' to ');
  return {
    title: `${name} Coloring Page`,
    description: `A ${name.toLowerCase()} coloring page. For about ages ${ages}.`,
    alt: `Line drawing of ${name.toLowerCase()}.`,
    parentNote: 'Color the big shapes first. The small parts can wait.',
  };
}

function uniqueSlug(base: string, used: Set<string>) {
  let slug = base || 'coloring-page';
  let n = 2;
  while (used.has(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  used.add(slug);
  return slug;
}

export async function scanImportFolder(folder: string, defaultAge: AgeBand = '3-4'): Promise<DraftSheet[]> {
  const root = path.resolve(folder);
  const files = await walkImages(root);
  if (!files.length) throw new Error('В папке нет PNG, JPG или SVG.');

  const thumbDir = path.join(factoryRoot, '.cache', 'import-thumbs');
  await fs.mkdir(thumbDir, { recursive: true });

  const used = new Set<string>();
  const drafts: DraftSheet[] = [];
  let index = 0;
  for (const file of files.sort((a, b) => a.localeCompare(b))) {
    index += 1;
    const age = ageFromPath(file, root) ?? defaultAge;
    const baseName = path.basename(file, path.extname(file));
    const fromName = slugify(baseName);
    const weak =
      !fromName ||
      /^(img|image|dsc|scan|photo|picture|untitled|new|copy|копия)/i.test(fromName) ||
      /^\d+$/.test(fromName) ||
      fromName.length < 3;
    const slug = uniqueSlug(weak ? `page-${index}` : fromName, used);
    const copy = defaultCopy(weak ? `page-${index}` : fromName, age);
    const id = `imp-${index}-${Date.now().toString(36)}`;
    const thumbPath = path.join(thumbDir, `${id}.jpg`);
    try {
      const source = path.extname(file).toLowerCase() === '.svg' ? await renderSvg(file) : await loadRaster(file);
      await sharp(source)
        .resize(280, 360, { fit: 'inside', background: '#ffffff' })
        .jpeg({ quality: 72 })
        .toFile(thumbPath);
    } catch {
      await sharp({
        create: { width: 280, height: 360, channels: 3, background: '#f3f8fc' },
      })
        .jpeg()
        .toFile(thumbPath);
    }
    drafts.push({
      id,
      file,
      age,
      slug,
      title: copy.title,
      description: copy.description,
      alt: copy.alt,
      parentNote: copy.parentNote,
      include: true,
      thumb: thumbPath,
    });
  }
  return drafts;
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Модель не вернула JSON.');
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, string>;
}

export async function nameDraftWithVision(draft: DraftSheet): Promise<DraftSheet> {
  loadEnv();
  const source =
    path.extname(draft.file).toLowerCase() === '.svg'
      ? await renderSvg(draft.file)
      : await loadRaster(draft.file);
  const small = await sharp(source)
    .resize(768, 1024, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  const system = [
    'You name free printable coloring pages for an American parents website called Something for Little Ones.',
    'Reply with JSON only. Keys: slug, title, description, alt, parentNote.',
    'slug: 2-5 English words, kebab-case, no numbers unless needed, no "coloring-page" suffix.',
    'title: short Title Case ending with "Coloring Page".',
    'description: one short sentence for parents, mention the age band lightly, no marketing fluff.',
    'alt: one short sentence starting with "Line drawing of".',
    'parentNote: one short tip for a parent, kitchen-table tone.',
    'Do not say the site owner drew the picture. Do not invent brand names or movie characters.',
    'No markdown outside the JSON object.',
  ].join(' ');
  const user = `Age band on the site: ${draft.age}. Look at this coloring page and name it.`;
  const reply = await visionChat(system, user, small);
  const json = extractJson(reply);
  const slug = slugify(json.slug || draft.slug) || draft.slug;
  const title = (json.title || draft.title).trim();
  return {
    ...draft,
    slug,
    title: /coloring page/i.test(title) ? title : `${title} Coloring Page`,
    description: (json.description || draft.description).trim(),
    alt: (json.alt || draft.alt).trim(),
    parentNote: (json.parentNote || draft.parentNote).trim(),
  };
}

async function nextThemeOrder(kind: string) {
  const files = (await fs.readdir(themeContentRoot)).filter((name) => name.endsWith('.md'));
  let max = 0;
  for (const file of files) {
    const data = frontmatter(await fs.readFile(path.join(themeContentRoot, file), 'utf8'));
    if (String(data.kind ?? 'evergreen') !== kind) continue;
    max = Math.max(max, Number(data.order ?? 0));
  }
  return max + 1;
}

export async function ensureTheme(options: {
  slug: string;
  title: string;
  kind: 'evergreen' | 'seasonal';
  ageBand: AgeBand;
  accent?: string;
  ink?: string;
}) {
  const file = path.join(themeContentRoot, `${options.slug}.md`);
  try {
    await fs.access(file);
    return options.slug;
  } catch {
    // create
  }
  const today = new Date().toISOString().slice(0, 10);
  const order = await nextThemeOrder(options.kind);
  const accent = options.accent ?? (options.kind === 'seasonal' ? '#1d7ad6' : '#1d7ad6');
  const ink = options.ink ?? '#243038';
  const short = options.title.replace(/ Coloring Pages$/i, '');
  const body = `These pages are grouped by age. Pick the group that matches how long your child will sit.

Download the PDF, not a screenshot of this page.`;
  const markdown = `---
title: ${q(options.title)}
description: ${q(`${options.title}. Pick an age, from big simple shapes to fuller scenes.`)}
tagline: ${q(`${short} coloring pages. Pick an age.`)}
kind: ${options.kind}
ageBand: "${options.ageBand}"
order: ${order}
accent: "${accent}"
ink: "${ink}"
related: []
pubDate: ${today}
updatedDate: ${today}
keywords:
  - ${options.title.toLowerCase()}
faqs:
  - question: How do I pick an age?
    answer: Match the lines, not the birthday. Ages 2–3 are one huge object. Ages 3–4 are thick lines and big spaces. Ages 4–5 add a few parts. Ages 5–6 are a small scene. Ages 6–8 are a fuller scene.
  - question: What paper size are the files?
    answer: I made these for letter paper. There's an A4 file too if that's what you have. Same drawing.
pins:
  - id: set
    title: ${q(`Free ${options.title}`)}
    subtitle: Printable coloring pages
---

${body}
`;
  await fs.writeFile(file, markdown, 'utf8');
  await fs.mkdir(path.join(sheetContentRoot, options.slug), { recursive: true });
  await fs.mkdir(path.join(printRoot, options.slug), { recursive: true });
  return options.slug;
}

function sheetMarkdown(
  theme: string,
  sheet: Pick<DraftSheet, 'slug' | 'title' | 'description' | 'alt' | 'parentNote' | 'age' | 'file'>,
  order: number,
) {
  const source = path.basename(sheet.file);
  return `---
title: ${q(sheet.title)}
theme: ${theme}
slug: ${sheet.slug}
description: ${q(sheet.description)}
alt: ${q(sheet.alt)}
parentNote: ${q(sheet.parentNote)}
order: ${order}
difficulty: ${difficulty[sheet.age]}
age: "${sheet.age}"
source: ${q(source)}
---
`;
}

async function preview(printPng: Buffer) {
  const meta = await sharp(printPng).metadata();
  const width = Math.min(1000, meta.width ?? 1000);
  return sharp(printPng).resize({ width, withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
}

/** Rebuild preview + PDFs only. Does not touch markdown or theme text. */
export async function publishPrintAssets(
  theme: string,
  sheet: Pick<DraftSheet, 'file' | 'slug' | 'title'>,
) {
  const site = readSite();
  const master = await loadSourceImage(sheet.file);
  const print = await stampSite(master);
  // pdf-lib is picky; re-encode a plain RGB PNG before embedding.
  const printForPdf = await sharp(print).removeAlpha().png({ compressionLevel: 9, force: true }).toBuffer();
  const web = await preview(print);
  const dir = path.join(printRoot, theme);
  await fs.mkdir(dir, { recursive: true });
  await writeFileSafe(path.join(dir, `${sheet.slug}.png`), web);
  const letterPdf = Buffer.from(await pngToPdf(printForPdf, 'letter', sheet.title, site.name));
  const a4Pdf = Buffer.from(await pngToPdf(printForPdf, 'a4', sheet.title, site.name));
  await writeFileSafe(path.join(dir, `${sheet.slug}-us-letter.pdf`), letterPdf);
  await writeFileSafe(path.join(dir, `${sheet.slug}-a4.pdf`), a4Pdf);
}

export async function publishDraft(theme: string, sheet: DraftSheet, order: number) {
  await publishPrintAssets(theme, sheet);
  const contentDir = path.join(sheetContentRoot, theme);
  await fs.mkdir(contentDir, { recursive: true });
  await fs.writeFile(path.join(contentDir, `${sheet.slug}.md`), sheetMarkdown(theme, sheet, order), 'utf8');
}

type ExistingSheet = {
  slug: string;
  title: string;
  age: AgeBand;
  order: number;
  source: string;
};

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/coloring pages?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export async function listThemeSheets(theme: string): Promise<ExistingSheet[]> {
  const dir = path.join(sheetContentRoot, theme);
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((name) => name.endsWith('.md'));
  } catch {
    return [];
  }
  const sheets: ExistingSheet[] = [];
  for (const file of files) {
    const data = frontmatter(await fs.readFile(path.join(dir, file), 'utf8'));
    sheets.push({
      slug: String(data.slug ?? file.replace(/\.md$/, '')),
      title: String(data.title ?? file),
      age: String(data.age ?? '3-4') as AgeBand,
      order: Number(data.order ?? 0),
      source: String(data.source ?? ''),
    });
  }
  return sheets.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
}

const FINGER_SIZE = 48;

/** Tiny grayscale fingerprint of the drawing (ignores page margins / footer). */
async function drawingFingerprint(image: Buffer, options?: { dropFooter?: boolean }) {
  let buf = image;
  if (options?.dropFooter) {
    const meta = await sharp(image).metadata();
    const width = meta.width ?? 1;
    const height = meta.height ?? 1;
    const band = footerHeight(width);
    const keep = Math.max(40, height - band);
    buf = await sharp(image)
      .extract({ left: 0, top: 0, width, height: keep })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer();
  } else {
    buf = await sharp(image).flatten({ background: '#ffffff' }).png().toBuffer();
  }
  try {
    buf = await sharp(buf).trim({ background: '#ffffff', threshold: 18 }).png().toBuffer();
  } catch {
    // keep
  }
  const { data } = await sharp(buf)
    .grayscale()
    .resize(FINGER_SIZE, FINGER_SIZE, { fit: 'fill', background: '#ffffff' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

function fingerprintDistance(a: Buffer, b: Buffer) {
  const n = Math.min(a.length, b.length);
  if (!n) return 1;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / (n * 255);
}

function applySheetMatch(draft: DraftSheet, match: ExistingSheet): DraftSheet {
  return {
    ...draft,
    slug: match.slug,
    title: match.title,
    age: match.age,
    include: true,
  };
}

export type MatchDraftsResult = {
  drafts: DraftSheet[];
  matched: number;
  siteSheets: ExistingSheet[];
};

/**
 * Match folder files to existing site sheets.
 * Tries filename/source/title first, then compares the drawing itself
 * (so random stock filenames still line up with pages on the site).
 */
export async function matchDraftsToTheme(
  theme: string,
  drafts: DraftSheet[],
  options?: { imagesOnly?: boolean },
): Promise<MatchDraftsResult> {
  const existing = await listThemeSheets(theme);
  if (!existing.length) return { drafts, matched: 0, siteSheets: existing };

  const bySlug = new Map(existing.map((sheet) => [sheet.slug, sheet]));
  const bySource = new Map(
    existing.filter((sheet) => sheet.source).map((sheet) => [sheet.source.toLowerCase(), sheet]),
  );
  const byTitle = new Map(existing.map((sheet) => [normalizeTitle(sheet.title), sheet]));
  const used = new Set<string>();
  const out: DraftSheet[] = drafts.map((draft) => ({ ...draft }));
  const matchedIndexes = new Set<number>();

  let matched = 0;
  for (let i = 0; i < out.length; i += 1) {
    const draft = out[i];
    const base = path.basename(draft.file);
    const baseSlug = slugify(path.basename(draft.file, path.extname(draft.file)));
    const candidates = [
      bySlug.get(slugify(draft.slug)),
      bySource.get(base.toLowerCase()),
      bySlug.get(baseSlug),
      byTitle.get(normalizeTitle(draft.title)),
    ].filter((sheet): sheet is ExistingSheet => Boolean(sheet));
    const match = candidates.find((sheet) => !used.has(sheet.slug));
    if (!match) continue;
    used.add(match.slug);
    matchedIndexes.add(i);
    out[i] = applySheetMatch(draft, match);
    matched += 1;
  }

  const pending = out
    .map((draft, index) => ({ draft, index }))
    .filter(({ index }) => !matchedIndexes.has(index));
  const freeSheets = existing.filter((sheet) => !used.has(sheet.slug));

  if (pending.length && freeSheets.length) {
    console.log(`Сопоставляю по рисунку: ${pending.length} файлов ↔ ${freeSheets.length} листов на сайте…`);
    const siteFingers: { sheet: ExistingSheet; finger: Buffer }[] = [];
    for (const sheet of freeSheets) {
      const previewPath = path.join(printRoot, theme, `${sheet.slug}.png`);
      try {
        const png = await fs.readFile(previewPath);
        siteFingers.push({ sheet, finger: await drawingFingerprint(png, { dropFooter: true }) });
      } catch {
        console.log(`нет превью для ${sheet.slug}`);
      }
    }

    const draftFingers: { index: number; finger: Buffer }[] = [];
    for (const item of pending) {
      try {
        const ext = path.extname(item.draft.file).toLowerCase();
        const raw = ext === '.svg' ? await renderSvg(item.draft.file) : await loadRaster(item.draft.file);
        draftFingers.push({ index: item.index, finger: await drawingFingerprint(raw) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`не прочитал ${path.basename(item.draft.file)}: ${message}`);
      }
    }

    type Pair = { draftIndex: number; sheet: ExistingSheet; distance: number };
    const pairs: Pair[] = [];
    for (const draft of draftFingers) {
      for (const site of siteFingers) {
        pairs.push({
          draftIndex: draft.index,
          sheet: site.sheet,
          distance: fingerprintDistance(draft.finger, site.finger),
        });
      }
    }
    pairs.sort((a, b) => a.distance - b.distance);

    // Clear matches only; resized/letterboxed copies of the same line art land well under this.
    const maxDistance = 0.24;
    const claimedDrafts = new Set<number>();
    let visualMatched = 0;
    for (const pair of pairs) {
      if (pair.distance > maxDistance) break;
      if (claimedDrafts.has(pair.draftIndex) || used.has(pair.sheet.slug)) continue;
      used.add(pair.sheet.slug);
      claimedDrafts.add(pair.draftIndex);
      matchedIndexes.add(pair.draftIndex);
      out[pair.draftIndex] = applySheetMatch(out[pair.draftIndex], pair.sheet);
      matched += 1;
      visualMatched += 1;
      console.log(`${path.basename(out[pair.draftIndex].file)} → ${pair.sheet.slug} (${pair.distance.toFixed(3)})`);
    }
    console.log(`По рисунку сопоставлено: ${visualMatched}`);
  }

  if (options?.imagesOnly) {
    for (let i = 0; i < out.length; i += 1) {
      if (matchedIndexes.has(i)) continue;
      out[i] = { ...out[i], include: false };
    }
  }

  console.log(`Итого сопоставлено с сайтом: ${matched} из ${drafts.length}`);
  return { drafts: out, matched, siteSheets: existing };
}

function linkLabel(title: string) {
  return title.replace(/ Coloring Page$/i, '').toLowerCase();
}

export async function rewriteThemeBody(theme: string) {
  const file = path.join(themeContentRoot, `${theme}.md`);
  const raw = await fs.readFile(file, 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error(`Не читается тема ${theme}`);
  const sheets = await listThemeSheets(theme);
  const lines = ['These pages are grouped by age. Pick the group that matches how long your child will sit.', ''];
  for (const age of AGE_BANDS) {
    const group = sheets.filter((sheet) => sheet.age === age);
    if (!group.length) continue;
    const links = group
      .map((sheet) => `[${linkLabel(sheet.title)}](/${theme}/${sheet.slug}/)`)
      .join(', ');
    const label = age.replace('-', '–');
    lines.push(`[Ages ${label}](#ages-${age}) includes ${links}.`);
    lines.push('');
  }
  lines.push('Download the PDF, not a screenshot of this page.');
  const today = new Date().toISOString().slice(0, 10);
  let fm = match[1];
  if (/^updatedDate:/m.test(fm)) fm = fm.replace(/^updatedDate:.*$/m, `updatedDate: ${today}`);
  else fm += `\nupdatedDate: ${today}`;
  await fs.writeFile(file, `---\n${fm}\n---\n\n${lines.join('\n')}\n`, 'utf8');
}

export async function commitImport(options: {
  theme: string;
  title?: string;
  kind?: 'evergreen' | 'seasonal';
  ageBand?: AgeBand;
  sheets: DraftSheet[];
  imagesOnly?: boolean;
}) {
  const included = options.sheets.filter((sheet) => sheet.include !== false);
  if (!included.length) throw new Error('Не выбран ни один лист.');

  let theme = options.theme.trim();
  const themes = (await fs.readdir(themeContentRoot)).filter((name) => name.endsWith('.md')).map((name) => name.replace(/\.md$/, ''));
  const imagesOnly = Boolean(options.imagesOnly);

  if (imagesOnly) {
    if (!theme || theme === '__new__' || !themes.includes(theme)) {
      throw new Error('Для «только картинки» выберите уже существующую подборку.');
    }
    const existing = await listThemeSheets(theme);
    const bySlug = new Map(existing.map((sheet) => [sheet.slug, sheet]));
    const updated: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];
    let index = 0;
    for (const draft of included) {
      index += 1;
      const slug = slugify(draft.slug);
      const target = bySlug.get(slug);
      if (!target) {
        skipped.push(`${path.basename(draft.file)} → slug «${slug || '?'}» на сайте нет`);
        console.log(`skip images-only: ${path.basename(draft.file)} (нет листа ${slug || 'без slug'})`);
        continue;
      }
      try {
        console.log(`images-only ${index}/${included.length}: ${target.slug}`);
        await publishPrintAssets(theme, { file: draft.file, slug: target.slug, title: target.title });
        updated.push(`${theme}/${target.slug}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push(`${target.slug}: ${message}`);
        console.log(`ошибка ${target.slug}: ${message}`);
      }
    }
    if (!updated.length) {
      throw new Error(
        failed.length
          ? `Ни один лист не записался. Первая ошибка: ${failed[0]}`
          : 'Не нашлось совпадений со страницами на сайте. В поле slug укажите имя листа как в URL (например ice-skating-friends).',
      );
    }
    if (skipped.length) {
      console.log(`Пропущено без совпадения: ${skipped.length}`);
      for (const line of skipped.slice(0, 12)) console.log(`  ${line}`);
      if (skipped.length > 12) console.log(`  …и ещё ${skipped.length - 12}`);
    }
    if (failed.length) {
      console.log(`С ошибкой записи: ${failed.length} (остальные обновлены)`);
      for (const line of failed.slice(0, 8)) console.log(`  ${line}`);
      if (failed.length > 8) console.log(`  …и ещё ${failed.length - 8}`);
    }
    console.log('Тексты, названия и FAQ не менялись — только PNG и PDF.');
    return { theme, published: updated };
  }

  if (!theme || theme === '__new__') {
    const title = (options.title ?? '').trim();
    if (title.length < 3) throw new Error('Напишите название новой подборки.');
    theme = /coloring-pages$/.test(slugify(title)) ? slugify(title) : `${slugify(title)}-coloring-pages`;
    if (themes.includes(theme)) throw new Error('Такая подборка уже есть. Выберите её в списке.');
    await ensureTheme({
      slug: theme,
      title: /coloring pages$/i.test(title) ? title : `${title} Coloring Pages`,
      kind: options.kind === 'seasonal' ? 'seasonal' : 'evergreen',
      ageBand: options.ageBand ?? included[0].age,
    });
  } else if (!themes.includes(theme)) {
    throw new Error('Подборка не найдена.');
  }

  const used = new Set<string>();
  const existing = await listThemeSheets(theme);
  for (const sheet of existing) used.add(sheet.slug);
  let order = existing.reduce((max, sheet) => Math.max(max, sheet.order), 0);

  const published: string[] = [];
  for (const draft of included) {
    let slug = slugify(draft.slug) || `page-${published.length + 1}`;
    slug = uniqueSlug(slug, used);
    order += 1;
    await publishDraft(theme, { ...draft, slug }, order);
    published.push(`${theme}/${slug}`);
    console.log(`import ${theme}/${slug} age ${draft.age}`);
  }
  await rewriteThemeBody(theme);
  return { theme, published };
}
