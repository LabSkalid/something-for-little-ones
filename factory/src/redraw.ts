import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { readSite } from './brand.ts';
import { stampSite } from './footer.ts';
import { fitPortrait, webPreview } from './lineart.ts';
import { coloringPrompt, generateColoringPage, editColoringPage, type LineDifficulty } from './openrouter.ts';
import { pngToPdf } from './pdf.ts';
import { loadEnv } from './env.ts';
import { briefsRoot, printRoot, sheetContentRoot } from './paths.ts';

function frontmatter(raw: string) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error('В странице нет шапки.');
  return parse(match[1]) as {
    title?: string;
    slug?: string;
    alt?: string;
    description?: string;
    difficulty?: LineDifficulty;
    age?: string;
  };
}

export async function redraw(themeFilter?: string, ageFilter?: string[], slugFilter?: string[]) {
  loadEnv();
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('Нет OPENROUTER_API_KEY. Добавьте ключ в factory/.env и запустите команду снова.');
  }
  const ages = ageFilter?.length ? new Set(ageFilter) : null;
  const slugs = slugFilter?.length ? new Set(slugFilter) : null;
  const site = readSite();
  const themes = await fs.readdir(sheetContentRoot, { withFileTypes: true });
  let count = 0;
  let skipped = 0;
  for (const theme of themes) {
    if (!theme.isDirectory()) continue;
    if (themeFilter && theme.name !== themeFilter) continue;
    let style =
      'Cute storybook coloring-page line art, thick even black outlines, pure white background, no shading, no hatching, no sketch marks, no text.';
    try {
      const brief = parse(await fs.readFile(path.join(briefsRoot, `${theme.name}.yaml`), 'utf8')) as { style?: string };
      if (brief.style) style = brief.style;
    } catch {
      // Задание необязательно: остаётся стиль по умолчанию.
    }
    const dir = path.join(sheetContentRoot, theme.name);
    const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.md'));
    for (const file of files) {
      const sheet = frontmatter(await fs.readFile(path.join(dir, file), 'utf8'));
      const age = sheet.age ?? '3-4';
      if (ages && !ages.has(age)) {
        skipped += 1;
        continue;
      }
      const slug = sheet.slug || file.replace(/\.md$/, '');
      if (slugs && !slugs.has(slug)) {
        skipped += 1;
        continue;
      }
      const title = sheet.title || slug;
      const subject = sheet.alt || sheet.description || title;
      console.log(`рисую ${theme.name}/${slug} (ages ${age})...`);
      const raw = await generateColoringPage(
        coloringPrompt(style, subject, sheet.difficulty ?? 'easy', age),
      );
      const print = await stampSite(await fitPortrait(raw));
      const preview = await webPreview(print);
      const out = path.join(printRoot, theme.name);
      await fs.mkdir(out, { recursive: true });
      await fs.writeFile(path.join(out, `${slug}.png`), preview);
      await fs.writeFile(path.join(out, `${slug}-us-letter.pdf`), await pngToPdf(print, 'letter', title, site.name));
      await fs.writeFile(path.join(out, `${slug}-a4.pdf`), await pngToPdf(print, 'a4', title, site.name));
      count += 1;
      console.log(`обновлён рисунок ${theme.name}/${slug}`);
    }
  }
  console.log(
    `Готово. Перерисовано страниц: ${count}.${skipped ? ` Пропущено по фильтру: ${skipped}.` : ''} Пины не менялись.`,
  );
}


/**
 * Experimental, non-destructive image-to-image simplification.
 * Reads source PNGs from a sibling `<theme>-originals` folder and writes only
 * timestamped PNG previews to a sibling `factory-review` folder. Never writes to the website.
 */
export async function simplifyOriginals(theme: string, slugs: string[], age: string) {
  loadEnv();
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('Нет OPENROUTER_API_KEY. Добавьте ключ в factory/.env и запустите команду снова.');
  }
  if (!/^[a-z0-9-]+$/i.test(theme)) throw new Error('Некорректное имя темы.');
  if (!slugs.length) throw new Error('Не выбраны исходные картинки.');
  const siblingRoot = path.resolve(printRoot, '..', '..', '..');
  const originalsRoot = process.env.FACTORY_ORIGINALS_ROOT
    ? path.resolve(process.env.FACTORY_ORIGINALS_ROOT)
    : path.join(siblingRoot, `${theme}-originals`);
  const reviewRoot = process.env.FACTORY_REVIEW_ROOT
    ? path.resolve(process.env.FACTORY_REVIEW_ROOT)
    : path.join(siblingRoot, 'factory-review', theme);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(reviewRoot, stamp);
  await fs.mkdir(runDir, { recursive: true });
  const safeSlugs = [...new Set(slugs)].filter((slug) => /^[a-z0-9][a-z0-9_-]*$/i.test(slug));
  if (!safeSlugs.length) throw new Error('В выборе нет корректных имён файлов.');
  const ageText = age.replace('-', '–');
  const instructions = [
    `Edit the provided reference image into a children's black-and-white coloring page for ages ${ageText}.`,
    'This is a constrained simplification/edit, NOT a redesign and NOT a new interpretation.',
    'Preserve the exact identity, silhouette, geometry, orientation, proportions, and arrangement of the original subject.',
    'Do not add, remove, merge, split, rotate, or rearrange any major shapes or symbolic elements.',
    'For a star, preserve the exact number, length, angle, and placement of every ray. For a cross, preserve the exact cross shape and bar placement. For a candle, preserve the candle body, wick, and flame shapes. For a wreath, preserve the ring silhouette and placement of its main elements.',
    'Only simplify small interior details and decorative complexity appropriate for the specified age. Keep the original composition and all meaningful contours.',
    'Pure white background, solid black clean closed outlines, consistent bold line weight, no gray, no color, no shading, no hatching, no text, no watermark, no new objects.',
    'Keep the same portrait/landscape orientation and overall framing as the reference image. Do not crop or zoom in.',
  ].join(' ');
  let ok = 0;
  for (const slug of safeSlugs) {
    const sourcePath = path.join(originalsRoot, `${slug}.png`);
    try {
      const source = await fs.readFile(sourcePath);
      console.log(`Упрощаю исходник ${theme}/${slug}.png для ${ageText}...`);
      const result = await editColoringPage(source, instructions);
      const outPath = path.join(runDir, `${slug}-review.png`);
      await fs.writeFile(outPath, result, { flag: 'wx' });
      ok += 1;
      console.log(`Предпросмотр сохранён: ${outPath}`);
    } catch (error) {
      console.error(`Не удалось обработать ${slug}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`Готово: ${ok}/${safeSlugs.length}. Исходники и файлы сайта не изменялись. Результаты: ${runDir}`);
}

export async function listOriginalPngs(theme: string) {
  if (!/^[a-z0-9-]+$/i.test(theme)) throw new Error('Некорректное имя темы.');
  const siblingRoot = path.resolve(printRoot, '..', '..', '..');
  const originalsRoot = process.env.FACTORY_ORIGINALS_ROOT
    ? path.resolve(process.env.FACTORY_ORIGINALS_ROOT)
    : path.join(siblingRoot, `${theme}-originals`);
  try {
    const files = await fs.readdir(originalsRoot, { withFileTypes: true });
    return {
      folder: originalsRoot,
      sheets: files
        .filter((file) => file.isFile() && file.name.toLowerCase().endsWith('.png'))
        .map((file) => ({ slug: file.name.replace(/\.png$/i, ''), filename: file.name }))
        .sort((a, b) => a.filename.localeCompare(b.filename)),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { folder: originalsRoot, sheets: [] };
    throw error;
  }
}
