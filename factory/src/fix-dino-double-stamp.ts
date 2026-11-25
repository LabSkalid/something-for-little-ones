/** Replace double-stamped print files with ready downloads (one site band). */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { readSite } from './brand.ts';
import { ensureSingleSiteStamp } from './footer.ts';
import { listThemeSheets, publishPrintAssets } from './import-stock.ts';
import { pngToPdf } from './pdf.ts';
import { printRoot } from './paths.ts';

const DINO = 'C:\\Users\\admin\\Downloads\\dino';
const THEME = 'dinosaur-scene-coloring-pages';
const SOURCES = new Set([
  'flowering-window.png',
  'greenhouse-in-spring-a-glass-greenhouse-filled-w.png',
  'spring-cottage-a-cozy-country-cottage-with-flowe.png',
  'spring-picnic-a-picnic-blanket-with-a-basket-san.png',
]);

async function writeAll(theme: string, slug: string, title: string, print: Buffer) {
  const site = readSite();
  const dir = path.join(printRoot, theme);
  await fs.mkdir(dir, { recursive: true });
  const meta = await sharp(print).metadata();
  const width = Math.min(1000, meta.width ?? 1000);
  const web = await sharp(print)
    .resize({ width, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const printForPdf = await sharp(print).removeAlpha().png({ compressionLevel: 9, force: true }).toBuffer();
  await fs.writeFile(path.join(dir, `${slug}.png`), web);
  await fs.writeFile(
    path.join(dir, `${slug}-us-letter.pdf`),
    await pngToPdf(printForPdf, 'letter', title, site.name),
  );
  await fs.writeFile(path.join(dir, `${slug}-a4.pdf`), await pngToPdf(printForPdf, 'a4', title, site.name));
}

const sheets = (await listThemeSheets(THEME)).filter((s) => SOURCES.has(s.source));
if (!sheets.length) throw new Error('Не найдены листы с source из Downloads/dino');

for (const sheet of sheets) {
  const file = path.join(DINO, sheet.source);
  try {
    await fs.access(file);
    console.log(`↻ ${sheet.slug} ← готовый файл ${sheet.source}`);
    await publishPrintAssets(THEME, {
      file,
      slug: sheet.slug,
      title: sheet.title,
      stripFrame: false,
    });
    continue;
  } catch {
  }
  console.warn(`↻ ${sheet.slug} ← repair (нет ${sheet.source} в Downloads/dino)`);
  const letterPng = path.join(printRoot, THEME, `${sheet.slug}.png`);
  const raw = await sharp(letterPng).flatten({ background: '#ffffff' }).png().toBuffer();
  const print = await ensureSingleSiteStamp(raw);
  await writeAll(THEME, sheet.slug, sheet.title, print);
}

console.log(`Готово: ${sheets.length} лист(ов), один штамп сайта.`);