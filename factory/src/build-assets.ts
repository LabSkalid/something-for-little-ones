import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { readSite } from './brand.ts';
import { stampSite } from './footer.ts';
import { pngToPdf } from './pdf.ts';
import { renderPin } from './pins.ts';
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

export async function buildPins(onlyTheme?: string) {
  await fs.mkdir(pinRoot, { recursive: true });
  const themes = await fs.readdir(themeContentRoot);
  for (const file of themes.filter((name) => name.endsWith('.md'))) {
    const themeId = file.replace(/\.md$/, '');
    if (onlyTheme && themeId !== onlyTheme) continue;
    const data = readFrontmatter(await fs.readFile(path.join(themeContentRoot, file), 'utf8')) as ThemeData;
    const sheetDir = path.join(sheetContentRoot, themeId);
    let sheetFiles: string[] = [];
    try {
      sheetFiles = (await fs.readdir(sheetDir)).filter((name) => name.endsWith('.md'));
    } catch {
      continue;
    }
    const sheets: SheetData[] = [];
    for (const sheetFile of sheetFiles) {
      const sheet = readFrontmatter(await fs.readFile(path.join(sheetDir, sheetFile), 'utf8')) as SheetData;
      sheets.push(sheet);
    }
    sheets.sort((a, b) => a.order - b.order);
    const pngs: Buffer[] = [];
    for (const sheet of sheets) {
      const pngPath = path.join(printRoot, themeId, `${sheet.slug}.png`);
      try {
        pngs.push(await drawingOnly(await fs.readFile(pngPath)));
      } catch {
        console.warn(`missing preview for ${themeId}/${sheet.slug}`);
      }
    }
    const pins = data.pins?.length ? data.pins : [{ id: 'set', title: data.title, subtitle: 'Free printable coloring pages' }];
    for (const [index, pin] of pins.entries()) {
      const images = pngs.slice(index, index + 4);
      const pool = images.length >= 4 ? images : pngs.slice(0, 4);
      if (!pool.length) continue;
      const png = renderPin({
        title: pin.title || data.title,
        subtitle: pin.subtitle,
        accent: data.accent || '#C4553A',
        brand: readSite().name,
        images: pool,
      });
      await fs.writeFile(path.join(pinRoot, `${themeId}-${pin.id}.png`), png);
      console.log(`pin ${themeId}-${pin.id}`);
    }
  }
}

export async function buildAssets() {
  await buildSheetAssets();
  await buildPins();
}
