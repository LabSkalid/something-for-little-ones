/**
 * Produce only the three toddler rockets. Does not rebuild pins.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parse } from 'yaml';

const require = createRequire('D:/KIDS/factory/package.json');
const { register } = require('tsx/esm/api');
register();

const { loadEnv } = await import('D:/KIDS/factory/src/env.ts');
const { readSite } = await import('D:/KIDS/factory/src/brand.ts');
const { stampSite } = await import('D:/KIDS/factory/src/footer.ts');
const { fitPortrait, webPreview } = await import('D:/KIDS/factory/src/lineart.ts');
const { coloringPrompt, generateColoringPage } = await import('D:/KIDS/factory/src/openrouter.ts');
const { pngToPdf } = await import('D:/KIDS/factory/src/pdf.ts');
const { printRoot, sheetContentRoot } = await import('D:/KIDS/factory/src/paths.ts');

loadEnv();

const briefPath = 'D:/KIDS/factory/briefs/rocket-coloring-pages-toddler.yaml';
const brief = parse(await fs.readFile(briefPath, 'utf8'));
const theme = brief.slug;
const only = process.argv.slice(2);
const ideas = brief.ideas.filter((idea) => !only.length || only.includes(idea.slug));

function yamlQuote(value) {
  return JSON.stringify(value);
}

function sheetMarkdown(idea, order) {
  return `---
title: ${yamlQuote(idea.title)}
theme: ${theme}
slug: ${idea.slug}
description: ${yamlQuote(idea.description)}
alt: ${yamlQuote(idea.alt)}
parentNote: ${yamlQuote(idea.parentNote)}
order: ${order}
difficulty: ${idea.difficulty}
age: ${yamlQuote(idea.age)}
---
`;
}

async function nextOrder() {
  const dir = path.join(sheetContentRoot, theme);
  let max = 0;
  for (const name of await fs.readdir(dir)) {
    if (!name.endsWith('.md')) continue;
    const raw = await fs.readFile(path.join(dir, name), 'utf8');
    const match = raw.match(/^order:\s*(\d+)/m);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error('Missing OPENROUTER_API_KEY in factory/.env');
}

const site = readSite();
let order = await nextOrder();
const dir = path.join(printRoot, theme);
await fs.mkdir(dir, { recursive: true });
await fs.mkdir(path.join(sheetContentRoot, theme), { recursive: true });

for (const idea of ideas) {
  const sheetFile = path.join(sheetContentRoot, theme, `${idea.slug}.md`);
  try {
    await fs.access(sheetFile);
    console.log(`skip existing ${idea.slug}`);
    continue;
  } catch {
    // new sheet
  }
  console.log(`drawing ${idea.slug}...`);
  const raw = await generateColoringPage(
    coloringPrompt(brief.style, idea.prompt, idea.difficulty, idea.age),
  );
  const print = await stampSite(await fitPortrait(raw));
  const preview = await webPreview(print);
  await fs.writeFile(path.join(dir, `${idea.slug}.png`), preview);
  await fs.writeFile(
    path.join(dir, `${idea.slug}-us-letter.pdf`),
    await pngToPdf(print, 'letter', idea.title, site.name),
  );
  await fs.writeFile(
    path.join(dir, `${idea.slug}-a4.pdf`),
    await pngToPdf(print, 'a4', idea.title, site.name),
  );
  await fs.writeFile(sheetFile, sheetMarkdown(idea, order));
  console.log(`wrote ${theme}/${idea.slug} order=${order}`);
  order += 1;
}

console.log('done (pins untouched)');
