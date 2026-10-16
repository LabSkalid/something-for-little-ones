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
const COVER_EXT = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.pdf']);

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

/** KDP stays crisp @ 300 dpi; download is smaller for email / Etsy / home print. */
export type PdfEncodePreset = 'kdp' | 'download';

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
  /**
   * Pad to an even page count with a final blank (KDP paperback).
   * Default: same as blankBacks. Turn off for digital download / print-at-home.
   */
  padEvenPages?: boolean;
  /** Full-page front cover (PNG/JPG/SVG/PDF), 8.5×11. First page of the output. */
  frontCover?: string;
  /** Full-page back cover (PNG/JPG/SVG/PDF), 8.5×11. Last page of the output. */
  backCover?: string;
  /** Optional pre-named pages (from vision). Otherwise filenames are used. */
  pages?: KdpPage[];
  /**
   * Image encode preset. Default: `kdp` when blank backs are on, else `download`
   * (smaller files for digital sales / home print).
   */
  encodePreset?: PdfEncodePreset;
};

/** Letter @ 300 dpi — same trim as KDP interior / download PDF. */
const LETTER_PX_W = 2550;
const LETTER_PX_H = 3300;

/** Fit a designed cover image to one letter page (no frame strip — keeps color fills). */
async function loadCoverLetter(file: string) {
  const resolved = path.resolve(file.trim());
  const ext = path.extname(resolved).toLowerCase();
  let source: Buffer;
  if (ext === '.svg') {
    const svg = await fs.readFile(resolved, 'utf8');
    source = Buffer.from(
      new Resvg(svg, { fitTo: { mode: 'width', value: LETTER_PX_W }, background: 'white' }).render().asPng(),
    );
  } else {
    source = await sharp(resolved).rotate().png().toBuffer();
  }
  return sharp(source)
    .resize(LETTER_PX_W, LETTER_PX_H, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer();
}

/** First page of a cover PDF → letter page via pdf-lib (keeps vectors when possible). */
async function addLetterPdfCoverPage(doc: PDFDocument, file: string) {
  const bytes = await fs.readFile(file);
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pageCount = src.getPageCount();
  if (pageCount < 1) {
    throw new Error(`В PDF обложки нет страниц: ${path.basename(file)}`);
  }
  const embeddedPages = await doc.embedPdf(bytes, [0]);
  const embedded = embeddedPages[0];
  if (!embedded) {
    throw new Error(`В PDF обложки нет страниц: ${path.basename(file)}`);
  }
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const scale = Math.min(PAGE_W / embedded.width, PAGE_H / embedded.height);
  const w = embedded.width * scale;
  const h = embedded.height * scale;
  page.drawPage(embedded, {
    x: (PAGE_W - w) / 2,
    y: (PAGE_H - h) / 2,
    width: w,
    height: h,
  });
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

/** Letter @ ~200 dpi — still sharp enough for home print of line art. */
const DOWNLOAD_PX_W = 1700;
const DOWNLOAD_PX_H = 2200;

/**
 * Encode a letter page image for PDF.
 * - kdp: 300 dpi, JPEG q92 (Amazon interior)
 * - download: ~200 dpi, grayscale JPEG q75 (digital download / print-at-home)
 */
export async function encodeLetterForPdf(letterPng: Buffer, preset: PdfEncodePreset = 'kdp') {
  let pipeline = sharp(letterPng).removeAlpha().flatten({ background: '#ffffff' });
  if (preset === 'download') {
    pipeline = pipeline
      .resize(DOWNLOAD_PX_W, DOWNLOAD_PX_H, { fit: 'inside', withoutEnlargement: false })
      .grayscale();
    return pipeline.jpeg({ quality: 75, mozjpeg: true, chromaSubsampling: '4:2:0' }).toBuffer();
  }
  // Dense line art as RGB PNG @ 2550×3300 balloons to ~2–4 MB/page in the PDF.
  // High-quality JPEG (4:4:4) keeps crisp black lines and lands ~0.3–0.7 MB/page.
  return pipeline.jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
}

/** Draw a full-page JPEG (already encoded) onto a new letter page. */
export async function addEncodedLetterPage(doc: PDFDocument, jpegBytes: Buffer) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const image = await doc.embedJpg(jpegBytes);
  page.drawImage(image, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
}

/** Full-page letter cover (PNG/JPG/SVG raster, or first page of a PDF) into an existing doc. */
export async function addLetterImagePage(
  doc: PDFDocument,
  file: string,
  preset: PdfEncodePreset = 'kdp',
) {
  const resolved = path.resolve(file.trim());
  const ext = path.extname(resolved).toLowerCase();
  if (!COVER_EXT.has(ext)) {
    throw new Error(
      `Обложка: нужен PNG, JPG, SVG или PDF (сейчас ${ext || 'без расширения'}): ${path.basename(resolved)}`,
    );
  }
  if (ext === '.pdf') {
    // Download: rasterize via pdf-lib embed then... keep vector embed (covers are 1 page).
    // For size, prefer copying first page as-is (usually already small design PDFs).
    await addLetterPdfCoverPage(doc, resolved);
    return;
  }
  const letterPng = await loadCoverLetter(resolved);
  const forPdf = await encodeLetterForPdf(letterPng, preset);
  await addEncodedLetterPage(doc, forPdf);
}

async function addArtPage(
  doc: PDFDocument,
  letterPng: Buffer,
  font: PDFFont,
  caption: string,
  showCaption: boolean,
  preset: PdfEncodePreset = 'kdp',
) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const forPdf = await encodeLetterForPdf(letterPng, preset);
  const image = await doc.embedJpg(forPdf);
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
  const padEvenPages = options.padEvenPages !== undefined ? Boolean(options.padEvenPages) : blankBacks;
  const encodePreset: PdfEncodePreset =
    options.encodePreset ?? (blankBacks ? 'kdp' : 'download');
  const frontCover = (options.frontCover ?? '').trim();
  const backCover = (options.backCover ?? '').trim();
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

  const defaultName = frontCover || backCover || !blankBacks
    ? `${slugifyName(title)}-download.pdf`
    : `${slugifyName(title)}.pdf`;
  const outFile =
    options.outFile?.trim() ||
    path.join(factoryRoot, 'out', 'kdp', defaultName);
  await fs.mkdir(path.dirname(outFile), { recursive: true });

  const fontBytes = await loadFontBytes();
  const kind = encodePreset === 'download' ? 'Download PDF' : 'KDP';
  console.log(`${kind}: ${pages.length} картинок → ${outFile}`);
  console.log(
    `Формат 8.5×11 in, Fredoka на титуле` +
      (showCaptions ? ', подписи под рисунками' : '') +
      (blankBacks ? ', пустые обороты' : ', без пустых страниц') +
      (encodePreset === 'download' ? ', лёгкое JPEG (~200 dpi, grayscale)' : ', JPEG q92 @ 300 dpi') +
      (frontCover ? ', обложка спереди' : '') +
      (backCover ? ', обложка сзади' : '') +
      ', без футера сайта',
  );

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes);
  doc.setTitle(title);
  if (author) doc.setAuthor(author);

  if (frontCover) {
    console.log(`Обложка (лицо): ${path.basename(frontCover)}`);
    await addLetterImagePage(doc, frontCover, encodePreset);
  }

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
    await addArtPage(doc, pagePng, font, page.caption, showCaptions, encodePreset);
    artPages += 1;
    if (blankBacks) await addBlankPage(doc);
  }

  if (backCover) {
    console.log(`Обложка (зад): ${path.basename(backCover)}`);
    await addLetterImagePage(doc, backCover, encodePreset);
  }

  if (padEvenPages && doc.getPageCount() % 2 === 1) await addBlankPage(doc);

  const pdf = await doc.save({ useObjectStreams: false });
  await fs.writeFile(outFile, pdf);

  const totalPages = doc.getPageCount();
  console.log(`Готово: ${artPages} рисунков, ${totalPages} страниц PDF`);
  console.log(`Файл: ${outFile}`);
  if (blankBacks || padEvenPages) {
    console.log('В KDP: Paperback → Black & white interior → 8.5" x 11" → Bleed: No Bleed');
    console.log(
      `Для обложки: page count = ${totalPages} (стороны в PDF). Физических листов примерно ${Math.ceil(totalPages / 2)}, но в калькулятор Amazon — ${totalPages}.`,
    );
  } else {
    console.log('PDF для скачивания / печати дома: 8.5×11, без пустых оборотов. Продай как digital download.');
  }
  return { outFile, artPages, pages: totalPages, files: pages.length };
}
