import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { fitOnLetter } from '../src/import-stock.ts';
import { footerHeight, stampSite } from '../src/footer.ts';
import { pngToPdf } from '../src/pdf.ts';
import { readSite } from '../src/brand.ts';
import { printRoot, sheetContentRoot } from '../src/paths.ts';

async function writeFileSafe(dest, data) {
  const tmp = path.join(
    os.tmpdir(),
    `sfl-refit-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(dest)}`,
  );
  await fs.writeFile(tmp, data);
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fs.copyFile(tmp, dest);
      await fs.unlink(tmp).catch(() => undefined);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  await fs.unlink(tmp).catch(() => undefined);
  throw lastError;
}

/** Extract the largest embedded RGB image from our letter PDF (full print resolution). */
async function extractFromLetterPdf(theme, slug) {
  const letterPath = path.join(printRoot, theme, `${slug}-us-letter.pdf`);
  const bytes = await fs.readFile(letterPath);
  const doc = await PDFDocument.load(bytes);
  let best = null;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (subtype !== PDFName.of('Image')) continue;
    const width = obj.dict.get(PDFName.of('Width'))?.numberValue;
    const height = obj.dict.get(PDFName.of('Height'))?.numberValue;
    const bpc = obj.dict.get(PDFName.of('BitsPerComponent'))?.numberValue ?? 8;
    if (!width || !height || bpc !== 8) continue;
    const colorSpace = obj.dict.get(PDFName.of('ColorSpace'));
    const csName = colorSpace === PDFName.of('DeviceRGB') || String(colorSpace).includes('RGB');
    if (!csName) continue;
    let samples;
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
  if (!best) throw new Error('no embedded RGB image in PDF');
  return sharp(Buffer.from(best.samples), {
    raw: { width: best.width, height: best.height, channels: 3 },
  })
    .png()
    .toBuffer();
}

async function loadExistingArt(theme, slug) {
  try {
    const fromPdf = await extractFromLetterPdf(theme, slug);
    // Drop footer band if present on the letter raster.
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

async function listAgeSlugs(theme, age) {
  const dir = path.join(sheetContentRoot, theme);
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.md'));
  const slugs = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(dir, file), 'utf8');
    if (new RegExp(`age:\\s*"${age}"`).test(raw)) slugs.push(file.replace(/\.md$/, ''));
  }
  return slugs.sort();
}

async function refitOne(theme, slug, title) {
  const art = await loadExistingArt(theme, slug);
  const fitted = await fitOnLetter(art);
  const print = await stampSite(fitted);
  const printForPdf = await sharp(print).removeAlpha().png({ compressionLevel: 9, force: true }).toBuffer();
  const web = await sharp(print)
    .resize({ width: 1000, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const dir = path.join(printRoot, theme);
  const site = readSite();
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

const theme = process.argv[2] || 'christmas-coloring-pages';
const age = process.argv[3] || '4-5';
const slugs = await listAgeSlugs(theme, age);
console.log(`Refit from site PDFs: ${theme} age ${age} (${slugs.length} sheets)`);
console.log('No source folder needed.');

let ok = 0;
const failed = [];
for (const [index, slug] of slugs.entries()) {
  try {
    const md = await fs.readFile(path.join(sheetContentRoot, theme, `${slug}.md`), 'utf8');
    const title = md.match(/^title:\s*"?(.*?)"?\s*$/m)?.[1]?.replace(/^"|"$/g, '') || slug;
    console.log(`${index + 1}/${slugs.length} ${slug}`);
    await refitOne(theme, slug, title);
    ok += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failed.push(`${slug}: ${message}`);
    console.log(`fail ${slug}: ${message}`);
  }
}
console.log(`Done: ${ok}/${slugs.length}`);
if (failed.length) {
  console.log('Failed:');
  for (const line of failed) console.log(' ', line);
  process.exitCode = 1;
}
