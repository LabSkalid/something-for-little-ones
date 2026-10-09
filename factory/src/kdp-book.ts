import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import { displayFontFile } from './fonts.ts';
import { loadEnv } from './env.ts';
import { loadSourceImage, slugify } from './import-stock.ts';
import { visionChat } from './openrouter.ts';
import { factoryRoot } from './paths.ts';
import { Resvg } from '@resvg/resvg-js';

const IMAGE_EXT = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp']);

/** Amazon KDP common coloring-book trim: 8.5 × 11 in, no bleed (PDF points). */
const PAGE_W = 612;
const PAGE_H = 792;
/** Space under the drawing for a short caption (PDF points). */
const CAPTION_BAND_PT = 46;
/** Same band in 300 dpi pixels (letter page). */
const CAPTION_BAND_PX = Math.round((CAPTION_BAND_PT / PAGE_H) * 3300);

export type KdpPage = {
  file: string;
  caption: string;
};

export type KdpBookOptions = {
  folder: string;
  title: string;
  subtitle?: string;
  author?: string;
  copyright?: string;
  /** Output PDF path. Default: factory/out/kdp/<slug>.pdf */
  outFile?: string;
  /** Blank page after each drawing (marker bleed-through). Default true. */
  blankBacks?: boolean;
  /** Title + copyright pages at the start. Default true. */
  frontMatter?: boolean;
  /** Show short captions under drawings. Default true. */
  captions?: boolean;
  /** Optional pre-named pages (from vision). Otherwise filenames are used. */
  pages?: KdpPage[];
};

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

function slugifyName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'kdp-book';
}

function assertPdfLatin(value: string, label: string) {
  if (!value) return;
  if (/[^\x09\x0A\x0D\x20-\x7E]/.test(value)) {
    throw new Error(
      `${label}: только латиница (шрифт Fredoka). Кириллицу оставь для обложки в KDP.`,
    );
  }
}

function captionFromFilename(file: string) {
  const base = path.basename(file, path.extname(file));
  if (/^untitled/i.test(base) || /^img[-_\d]/i.test(base) || /^dsc/i.test(base)) return '';
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .slice(0, 40);
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Модель не вернула JSON.');
  return JSON.parse(raw.slice(start, end + 1)) as { caption?: string; title?: string; name?: string };
}

async function loadFontBytes() {
  const file = displayFontFile();
  if (!file) throw new Error('Не найден шрифт Fredoka / запасной TTF.');
  return new Uint8Array(await fs.readFile(file));
}

async function addBlankPage(doc: PDFDocument) {
  doc.addPage([PAGE_W, PAGE_H]);
}

function addTitlePage(
  doc: PDFDocument,
  font: PDFFont,
  lines: { text: string; size: number; gap?: number }[],
) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H * 0.64;
  for (const line of lines) {
    const width = font.widthOfTextAtSize(line.text, line.size);
    page.drawText(line.text, {
      x: Math.max(36, (PAGE_W - width) / 2),
      y,
      size: line.size,
      font,
      color: rgb(0.12, 0.14, 0.18),
      maxWidth: PAGE_W - 72,
    });
    y -= line.gap ?? line.size + 18;
  }
}

async function addArtPage(
  doc: PDFDocument,
  letterPng: Buffer,
  font: PDFFont,
  caption: string,
  showCaption: boolean,
) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const forPdf = await sharp(letterPng).removeAlpha().png({ compressionLevel: 9, force: true }).toBuffer();
  const image = await doc.embedPng(forPdf);
  page.drawImage(image, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });

  const label = caption.trim();
  if (!showCaption || !label) return;
  assertPdfLatin(label, `Подпись «${label}»`);
  const size = 13;
  const width = font.widthOfTextAtSize(label, size);
  page.drawText(label, {
    x: Math.max(36, (PAGE_W - width) / 2),
    y: 22,
    size,
    font,
    color: rgb(0.25, 0.28, 0.32),
  });
}

export async function listKdpPages(folder: string): Promise<KdpPage[]> {
  const root = path.resolve(folder.trim());
  const files = (await walkImages(root)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!files.length) throw new Error('В папке нет SVG, PNG или JPG.');
  return files.map((file) => ({ file, caption: captionFromFilename(file) }));
}

function normFileKey(file: string) {
  return path.resolve(file).replace(/\\/g, '/').toLowerCase();
}

/** Short caption from import draft title/slug (no vision). */
export function captionFromImportDraft(draft: { title?: string; slug?: string; file?: string }) {
  const fromTitle = String(draft.title ?? '')
    .replace(/\s*Coloring Pages?\s*$/i, '')
    .replace(/['"]/g, '')
    .trim();
  if (fromTitle && !/^untitled/i.test(fromTitle) && !/^page[- ]?\d+/i.test(fromTitle)) {
    return fromTitle.slice(0, 40);
  }
  const slug = String(draft.slug ?? '').trim();
  if (slug && !/^page-\d+/i.test(slug)) {
    return slug
      .split('-')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
      .slice(0, 40);
  }
  return draft.file ? captionFromFilename(draft.file) : '';
}

/**
 * Copy captions onto KDP pages from import drafts (same file path or basename).
 * Use after vision ran on the Import tab by mistake.
 */
export function applyImportCaptions(
  pages: KdpPage[],
  drafts: { file: string; title?: string; slug?: string }[],
): { pages: KdpPage[]; applied: number } {
  const byPath = new Map<string, (typeof drafts)[number]>();
  const byBase = new Map<string, (typeof drafts)[number]>();
  for (const draft of drafts) {
    byPath.set(normFileKey(draft.file), draft);
    byBase.set(path.basename(draft.file).toLowerCase(), draft);
  }
  let applied = 0;
  const next = pages.map((page) => {
    const draft = byPath.get(normFileKey(page.file)) ?? byBase.get(path.basename(page.file).toLowerCase());
    if (!draft) return page;
    const caption = captionFromImportDraft(draft);
    if (!caption) return page;
    applied += 1;
    return { ...page, caption };
  });
  return { pages: next, applied };
}

/** Cheap vision: short English label for the drawing (animal / subject). */
export async function nameKdpPage(page: KdpPage): Promise<KdpPage> {
  loadEnv();
  const ext = path.extname(page.file).toLowerCase();
  let source: Buffer;
  if (ext === '.svg') {
    const svg = await fs.readFile(page.file, 'utf8');
    source = Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: 1200 }, background: 'white' }).render().asPng());
  } else {
    source = await sharp(page.file).flatten({ background: '#ffffff' }).png().toBuffer();
  }
  const small = await sharp(source)
    .resize(768, 1024, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  const system = [
    'You label simple kids coloring-page drawings for a printed Amazon coloring book.',
    'Reply with JSON only: {"caption":"..."}.',
    'caption: 1-4 English words, Title Case, the main subject only (e.g. "Bunny", "Garden Fox", "Bee and Flower").',
    'No "coloring page", no ages, no brands, no movie characters, no quotes.',
  ].join(' ');
  const reply = await visionChat(system, 'What is the main subject of this coloring page?', small);
  const json = extractJson(reply);
  const caption = String(json.caption || json.title || json.name || page.caption || '')
    .replace(/coloring pages?/gi, '')
    .replace(/['"]/g, '')
    .trim()
    .slice(0, 40);
  return { ...page, caption: caption || page.caption || slugify(path.basename(page.file, ext)) };
}

/**
 * Build one Amazon KDP interior PDF from a folder of SVG/PNG drawings.
 * Strips stock frames, fills the page, no site footer. Optional captions + Fredoka title.
 */
export async function buildKdpBook(options: KdpBookOptions) {
  const folder = path.resolve(options.folder.trim());
  const title = options.title.trim();
  if (!title) throw new Error('Напишите название книги.');
  if (!folder) throw new Error('Укажите папку с SVG/PNG.');

  const pages =
    options.pages?.length && options.pages.every((page) => page.file)
      ? options.pages
      : await listKdpPages(folder);

  const blankBacks = options.blankBacks !== false;
  const frontMatter = options.frontMatter !== false;
  const showCaptions = options.captions !== false;
  const subtitle = (options.subtitle ?? '').trim();
  const author = (options.author ?? '').trim();
  const copyright =
    (options.copyright ?? '').trim() ||
    (author ? `Copyright (c) ${new Date().getFullYear()} ${author}. All rights reserved.` : '');

  if (frontMatter) {
    assertPdfLatin(title, 'Название');
    assertPdfLatin(subtitle, 'Подзаголовок');
    assertPdfLatin(author, 'Автор');
    assertPdfLatin(copyright, 'Copyright');
  }
  if (showCaptions) {
    for (const page of pages) assertPdfLatin(page.caption, `Подпись для ${path.basename(page.file)}`);
  }

  const outFile =
    options.outFile?.trim() ||
    path.join(factoryRoot, 'out', 'kdp', `${slugifyName(title)}.pdf`);
  await fs.mkdir(path.dirname(outFile), { recursive: true });

  const fontBytes = await loadFontBytes();
  console.log(`KDP: ${pages.length} картинок → ${outFile}`);
  console.log(
    `Формат 8.5×11 in, Fredoka на титуле` +
      (showCaptions ? ', подписи под рисунками' : '') +
      (blankBacks ? ', пустые обороты' : '') +
      ', без футера сайта',
  );

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes);
  doc.setTitle(title);
  if (author) doc.setAuthor(author);

  if (frontMatter) {
    addTitlePage(doc, font, [
      { text: title, size: 34, gap: subtitle ? 16 : 28 },
      ...(subtitle ? [{ text: subtitle, size: 16, gap: 28 }] : []),
      ...(author ? [{ text: author, size: 14, gap: 36 }] : []),
    ]);
    if (copyright) {
      addTitlePage(doc, font, [
        { text: copyright, size: 11, gap: 20 },
        { text: 'For personal use. No resale of the digital files.', size: 10, gap: 14 },
      ]);
    }
  }

  let artPages = 0;
  for (const [index, page] of pages.entries()) {
    console.log(`KDP ${index + 1}/${pages.length}: ${path.basename(page.file)}${page.caption ? ` — ${page.caption}` : ''}`);
    const pagePng = await loadSourceImage(page.file, {
      bottomExtraPx: showCaptions && page.caption.trim() ? CAPTION_BAND_PX : 0,
    });
    await addArtPage(doc, pagePng, font, page.caption, showCaptions);
    artPages += 1;
    if (blankBacks) await addBlankPage(doc);
  }

  if (doc.getPageCount() % 2 === 1) await addBlankPage(doc);

  const pdf = await doc.save({ useObjectStreams: false });
  await fs.writeFile(outFile, pdf);

  const totalPages = doc.getPageCount();
  console.log(`Готово: ${artPages} рисунков, ${totalPages} страниц PDF`);
  console.log(`Файл: ${outFile}`);
  console.log('В KDP: Paperback → Black & white interior → 8.5" x 11" → Bleed: No Bleed');
  return { outFile, artPages, pages: totalPages, files: pages.length };
}
