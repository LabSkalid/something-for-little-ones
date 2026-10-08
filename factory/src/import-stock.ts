import fs from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { parse } from 'yaml';
import { readSite } from './brand.ts';
import { stampSite } from './footer.ts';
import { loadEnv } from './env.ts';
import { visionChat } from './openrouter.ts';
import { pngToPdf } from './pdf.ts';
import { factoryRoot, printRoot, sheetContentRoot, themeContentRoot } from './paths.ts';

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

/** Place the drawing on a US Letter white page, centered, with margin. */
export async function fitOnLetter(image: Buffer) {
  const letterW = 2550;
  const letterH = 3300;
  const margin = 140;
  const maxW = letterW - margin * 2;
  const maxH = letterH - margin * 2;
  const resized = await sharp(image)
    .resize(maxW, maxH, { fit: 'inside', withoutEnlargement: true, background: '#ffffff' })
    .png()
    .toBuffer();
  const meta = await sharp(resized).metadata();
  const left = Math.max(0, Math.round((letterW - (meta.width ?? 0)) / 2));
  const top = Math.max(0, Math.round((letterH - (meta.height ?? 0)) / 2));
  return sharp({
    create: { width: letterW, height: letterH, channels: 3, background: '#ffffff' },
  })
    .composite([{ input: resized, left, top }])
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
  sheet: Pick<DraftSheet, 'slug' | 'title' | 'description' | 'alt' | 'parentNote' | 'age'>,
  order: number,
) {
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
---
`;
}

async function preview(printPng: Buffer) {
  const meta = await sharp(printPng).metadata();
  const width = Math.min(1000, meta.width ?? 1000);
  return sharp(printPng).resize({ width, withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
}

export async function publishDraft(theme: string, sheet: DraftSheet, order: number) {
  const site = readSite();
  const master = await loadSourceImage(sheet.file);
  const print = await stampSite(master);
  const web = await preview(print);
  const dir = path.join(printRoot, theme);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${sheet.slug}.png`), web);
  await fs.writeFile(path.join(dir, `${sheet.slug}-us-letter.pdf`), await pngToPdf(print, 'letter', sheet.title, site.name));
  await fs.writeFile(path.join(dir, `${sheet.slug}-a4.pdf`), await pngToPdf(print, 'a4', sheet.title, site.name));
  const contentDir = path.join(sheetContentRoot, theme);
  await fs.mkdir(contentDir, { recursive: true });
  await fs.writeFile(path.join(contentDir, `${sheet.slug}.md`), sheetMarkdown(theme, sheet, order), 'utf8');
}

async function listThemeSheets(theme: string) {
  const dir = path.join(sheetContentRoot, theme);
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((name) => name.endsWith('.md'));
  } catch {
    return [];
  }
  const sheets = [];
  for (const file of files) {
    const data = frontmatter(await fs.readFile(path.join(dir, file), 'utf8'));
    sheets.push({
      slug: String(data.slug ?? file.replace(/\.md$/, '')),
      title: String(data.title ?? file),
      age: String(data.age ?? '3-4') as AgeBand,
      order: Number(data.order ?? 0),
    });
  }
  return sheets.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
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
}) {
  const included = options.sheets.filter((sheet) => sheet.include !== false);
  if (!included.length) throw new Error('Не выбран ни один лист.');

  let theme = options.theme.trim();
  const themes = (await fs.readdir(themeContentRoot)).filter((name) => name.endsWith('.md')).map((name) => name.replace(/\.md$/, ''));
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
