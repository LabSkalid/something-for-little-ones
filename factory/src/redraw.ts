import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { readSite } from './brand.ts';
import { stampSite } from './footer.ts';
import { fitPortrait, webPreview } from './lineart.ts';
import { coloringPrompt, generateColoringPage } from './openrouter.ts';
import { pngToPdf } from './pdf.ts';
import { buildPins } from './build-assets.ts';
import { loadEnv } from './env.ts';
import { briefsRoot, printRoot, sheetContentRoot } from './paths.ts';

function frontmatter(raw: string) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error('В странице нет шапки.');
  return parse(match[1]) as { title?: string; slug?: string; alt?: string; description?: string };
}

export async function redraw(themeFilter?: string) {
  loadEnv();
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('Нет OPENROUTER_API_KEY. Добавьте ключ в factory/.env и запустите команду снова.');
  }
  const site = readSite();
  const themes = await fs.readdir(sheetContentRoot, { withFileTypes: true });
  let count = 0;
  for (const theme of themes) {
    if (!theme.isDirectory()) continue;
    if (themeFilter && theme.name !== themeFilter) continue;
    let style = 'Cute storybook line art, thick black outlines, white background, no shading, no text.';
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
      const slug = sheet.slug || file.replace(/\.md$/, '');
      const title = sheet.title || slug;
      const subject = sheet.alt || sheet.description || title;
      console.log(`рисую ${theme.name}/${slug}...`);
      const raw = await generateColoringPage(coloringPrompt(style, subject));
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
  await buildPins();
  console.log(`Готово. Перерисовано страниц: ${count}. Тексты статей не менялись.`);
}
