import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { readSite } from './brand.ts';
import { footerHeight, stampSite } from './footer.ts';
import { fitOnLetter, listThemeSheets } from './import-stock.ts';
import { pngToPdf } from './pdf.ts';
import { printRoot } from './paths.ts';

async function writeFileSafe(dest: string, data: Buffer) {
  const tmp = path.join(
    os.tmpdir(),
    `sfl-refit-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(dest)}`,
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
  throw lastError;
}

/** Extract the largest embedded RGB image from our letter PDF (full print resolution). */
async function extractFromLetterPdf(theme: string, slug: string) {
  const letterPath = path.join(printRoot, theme, `${slug}-us-letter.pdf`);
  const bytes = await fs.readFile(letterPath);
  const doc = await PDFDocument.load(bytes);
  let best: { width: number; height: number; samples: Uint8Array; area: number } | null = null;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (subtype !== PDFName.of('Image')) continue;
    const width = (obj.dict.get(PDFName.of('Width')) as { numberValue?: number } | undefined)?.numberValue;
    const height = (obj.dict.get(PDFName.of('Height')) as { numberValue?: number } | undefined)?.numberValue;
    const bpc =
      (obj.dict.get(PDFName.of('BitsPerComponent')) as { numberValue?: number } | undefined)?.numberValue ?? 8;
    if (!width || !height || bpc !== 8) continue;
    const colorSpace = obj.dict.get(PDFName.of('ColorSpace'));
    const csName = colorSpace === PDFName.of('DeviceRGB') || String(colorSpace).includes('RGB');
    if (!csName) continue;
    let samples: Uint8Array;
    try {
      samples = zlib.inflateSync(obj.contents);
    } catch {
      samples = obj.getContents();
    }
    const expected = width * height * 3;
    if (samples.length < expected * 0.9) continue;
    const area = width * height;
    if (!best || area > best.area) {
      best = { width, height, samples: samples.subarray(0, expected), area };
    }
  }
  if (!best) throw new Error('В letter PDF нет встроенной RGB-картинки.');
  return sharp(Buffer.from(best.samples), {
    raw: { width: best.width, height: best.height, channels: 3 },
  })
    .png()
    .toBuffer();
}

async function loadExistingArt(theme: string, slug: string) {
  try {
    const fromPdf = await extractFromLetterPdf(theme, slug);
    const meta = await sharp(fromPdf).metadata();
    const width = meta.width ?? 1;
    const height = meta.height ?? 1;
    const band = footerHeight(width);
    if (height > band + 80) {
      return sharp(fromPdf)
        .extract({ left: 0, top: 0, width, height: height - band })
        .png()
        .toBuffer();
    }
    return fromPdf;
  } catch {
    const pngPath = path.join(printRoot, theme, `${slug}.png`);
    const png = await fs.readFile(pngPath);
    const meta = await sharp(png).metadata();
    const width = meta.width ?? 1;
    const height = meta.height ?? 1;
    const band = footerHeight(width);
    return sharp(png)
      .extract({ left: 0, top: 0, width, height: Math.max(40, height - band) })
      .png()
      .toBuffer();
  }
}

export async function listRefitSheets(theme: string) {
  const sheets = await listThemeSheets(theme);
  return Promise.all(
    sheets.map(async (sheet) => {
      const letter = path.join(printRoot, theme, `${sheet.slug}-us-letter.pdf`);
      const png = path.join(printRoot, theme, `${sheet.slug}.png`);
      let hasLetter = false;
      let hasPng = false;
      try {
        await fs.access(letter);
        hasLetter = true;
      } catch {
        // none
      }
      try {
        await fs.access(png);
        hasPng = true;
      } catch {
        // none
      }
      return { ...sheet, hasLetter, hasPng };
    }),
  );
}

async function refitOne(theme: string, slug: string, title: string, stripFrame: boolean) {
  const art = await loadExistingArt(theme, slug);
  const fitted = await fitOnLetter(art, { stripFrame });
  const print = await stampSite(fitted);
  const printForPdf = await sharp(print).removeAlpha().png({ compressionLevel: 9, force: true }).toBuffer();
  const web = await sharp(print)
    .resize({ width: 1000, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const dir = path.join(printRoot, theme);
  const site = readSite();
  await fs.mkdir(dir, { recursive: true });
  await writeFileSafe(path.join(dir, `${slug}.png`), web);
  await writeFileSafe(
    path.join(dir, `${slug}-us-letter.pdf`),
    Buffer.from(await pngToPdf(printForPdf, 'letter', title, site.name)),
  );
  await writeFileSafe(
    path.join(dir, `${slug}-a4.pdf`),
    Buffer.from(await pngToPdf(printForPdf, 'a4', title, site.name)),
  );
}

/**
 * Refit selected published sheets using letter PDF (or preview PNG) already on the site.
 * No AI, no source folder. Markdown/text unchanged.
 */
export async function refitFromSite(options: {
  theme: string;
  slugs?: string[];
  age?: string;
  items?: { slug: string; stripFrame?: boolean }[];
}) {
  const theme = options.theme.trim();
  if (!theme) throw new Error('Укажите подборку.');
  let sheets = await listThemeSheets(theme);
  if (!sheets.length) throw new Error(`В подборке нет листов: ${theme}`);
  if (options.age) sheets = sheets.filter((sheet) => sheet.age === options.age);
  const stripBySlug = new Map(
    (options.items ?? []).map((item) => [item.slug, Boolean(item.stripFrame)]),
  );
  const want = options.items?.length
    ? new Set(options.items.map((item) => item.slug))
    : options.slugs?.length
      ? new Set(options.slugs)
      : null;
  if (want) sheets = sheets.filter((sheet) => want.has(sheet.slug));
  if (!sheets.length) throw new Error('Не выбрано ни одного листа.');

  console.log(`Поправка с сайта: ${theme}, ${sheets.length} лист(ов). Тексты не трогаю.`);

  let ok = 0;
  const failed: string[] = [];
  for (const [index, sheet] of sheets.entries()) {
    const stripFrame = stripBySlug.has(sheet.slug) ? Boolean(stripBySlug.get(sheet.slug)) : true;
    try {
      console.log(
        `${index + 1}/${sheets.length}: ${sheet.slug} · ${stripFrame ? 'снять рамку' : 'рамку оставить'}`,
      );
      await refitOne(theme, sheet.slug, sheet.title, stripFrame);
      ok += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push(`${sheet.slug}: ${message}`);
      console.log(`не вышло ${sheet.slug}: ${message}`);
    }
  }
  console.log(`Готово: ${ok}/${sheets.length}. Тексты на сайте не трогала.`);
  if (failed.length) {
    console.log('Не удалось:');
    for (const line of failed) console.log(`  ${line}`);
  }
  return { ok, total: sheets.length, failed };
}
