import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { readSite } from './brand.ts';
import { stampSite } from './footer.ts';
import { fitPortrait, webPreview } from './lineart.ts';
import { chat, coloringPrompt, generateColoringPage } from './openrouter.ts';
import { pngToPdf } from './pdf.ts';
import { buildPins } from './build-assets.ts';
import { loadEnv } from './env.ts';
import { printRoot, sheetContentRoot, themeContentRoot } from './paths.ts';

const blocked = [
  /disney/i,
  /mickey/i,
  /minnie/i,
  /elsa/i,
  /frozen/i,
  /pok[eé]mon/i,
  /pikachu/i,
  /mario/i,
  /barbie/i,
  /hello kitty/i,
  /paw patrol/i,
  /bluey/i,
  /cocomelon/i,
  /spider-?man/i,
  /batman/i,
  /marvel/i,
  /sonic/i,
  /peppa/i,
];

const ideaSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(3),
  prompt: z.string().min(8),
  difficulty: z.enum(['easy', 'medium']).default('easy'),
  age: z.string().default('4-8'),
  parentNote: z.string().optional(),
});

const briefSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  tagline: z.string(),
  description: z.string(),
  kind: z.enum(['evergreen', 'seasonal']),
  order: z.number().default(1),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  ink: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#241C18'),
  keywords: z.array(z.string()).default([]),
  related: z.array(z.string()).default([]),
  audience: z.string(),
  style: z.string(),
  ideas: z.array(ideaSchema).min(1),
  pins: z
    .array(z.object({ id: z.string(), title: z.string(), subtitle: z.string() }))
    .default([{ id: 'set', title: '', subtitle: 'Free printable coloring pages' }]),
});

type Brief = z.infer<typeof briefSchema>;
type Idea = z.infer<typeof ideaSchema>;

function assertOriginal(text: string) {
  const hit = blocked.find((pattern) => pattern.test(text));
  if (hit) {
    throw new Error(`Идея похожа на чужого персонажа (${hit}). Нужен свой сюжет, без фильмов и игрушечных брендов.`);
  }
}

function yamlQuote(value: string) {
  return JSON.stringify(value);
}

function sheetMarkdown(brief: Brief, idea: Idea, order: number, note: string, description: string, alt: string) {
  return `---
title: ${yamlQuote(idea.title)}
theme: ${brief.slug}
slug: ${idea.slug}
description: ${yamlQuote(description)}
alt: ${yamlQuote(alt)}
parentNote: ${yamlQuote(note)}
order: ${order}
difficulty: ${idea.difficulty}
age: ${yamlQuote(idea.age)}
---
`;
}

async function describeSheet(brief: Brief, idea: Idea) {
  if (idea.parentNote) {
    return {
      parentNote: idea.parentNote,
      description: `${idea.title} to print for kids.`,
      alt: `Line drawing of ${idea.prompt}`,
    };
  }
  const raw = await chat(
    'You write for American parents. Reply with JSON only: {"description":"","alt":"","parentNote":""}. description is under 160 characters. alt describes the line drawing. parentNote is 2 sentences about how a child might color the page. No trademarked characters. No mention of AI.',
    `Theme: ${brief.title}. Audience: ${brief.audience}. Page title: ${idea.title}. Subject: ${idea.prompt}.`,
  );
  const json = JSON.parse(raw.replace(/^```json\s*|```$/g, '')) as {
    description: string;
    alt: string;
    parentNote: string;
  };
  return json;
}

async function ensureTheme(brief: Brief, sheetLinks: { title: string; slug: string }[]) {
  const themeFile = path.join(themeContentRoot, `${brief.slug}.md`);
  try {
    await fs.access(themeFile);
    return;
  } catch {
    // The collection page does not exist yet.
  }
  const links = sheetLinks
    .map((sheet) => `- [${sheet.title}](/${brief.slug}/${sheet.slug}/)`)
    .join('\n');
  const related = brief.related.map((slug) => `- [${slug}](/${slug}/)`).join('\n');
  let article = `This set is ${brief.title.toLowerCase()} for ${brief.audience}.\n\n${links}\n\nSee also:\n\n${related}\n\nPrint the PDF in US Letter or A4. The [printing guide](/how-to-print/) covers the settings.`;
  let faqs = [
    { question: 'What paper size are these?', answer: 'Each page has a US Letter PDF and an A4 PDF.' },
    { question: 'Who are they for?', answer: brief.audience },
  ];
  let tagline = brief.tagline;
  let description = brief.description;
  try {
    const raw = await chat(
      'You write a parent-facing coloring set article in American English. Reply with JSON only: {"tagline":"","description":"","article":"","faqs":[{"question":"","answer":""}]}. article is markdown, 350-500 words, and must include the exact links you are given. No trademarked characters. No mention of AI.',
      `Title: ${brief.title}\nAudience: ${brief.audience}\nStyle: ${brief.style}\nRequired links:\n${links}\nRelated sets:\n${related}\nAlso link /how-to-print/.`,
    );
    const json = JSON.parse(raw.replace(/^```json\s*|```$/g, '')) as {
      tagline: string;
      description: string;
      article: string;
      faqs: { question: string; answer: string }[];
    };
    tagline = json.tagline || tagline;
    description = json.description || description;
    article = json.article || article;
    if (json.faqs?.length) faqs = json.faqs;
  } catch (error) {
    console.warn(`Текст темы оставлен коротким: ${(error as Error).message}`);
  }
  const pins = brief.pins.map((pin) => ({
    ...pin,
    title: pin.title || brief.title,
  }));
  const today = new Date().toISOString().slice(0, 10);
  const body = `---
title: ${yamlQuote(brief.title)}
description: ${yamlQuote(description)}
tagline: ${yamlQuote(tagline)}
kind: ${brief.kind}
order: ${brief.order}
accent: ${yamlQuote(brief.accent)}
ink: ${yamlQuote(brief.ink)}
related:
${brief.related.map((item) => `  - ${item}`).join('\n')}
pubDate: ${today}
updatedDate: ${today}
keywords:
${brief.keywords.map((item) => `  - ${item}`).join('\n')}
faqs:
${faqs
  .map(
    (faq) => `  - question: ${yamlQuote(faq.question)}
    answer: ${yamlQuote(faq.answer)}`,
  )
  .join('\n')}
pins:
${pins
  .map(
    (pin) => `  - id: ${pin.id}
    title: ${yamlQuote(pin.title)}
    subtitle: ${yamlQuote(pin.subtitle)}`,
  )
  .join('\n')}
---

${article}
`;
  await fs.mkdir(themeContentRoot, { recursive: true });
  await fs.writeFile(themeFile, body);
  console.log(`theme ${brief.slug}`);
}

async function nextOrder(theme: string) {
  const dir = path.join(sheetContentRoot, theme);
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((name) => name.endsWith('.md'));
  } catch {
    return 1;
  }
  let max = 0;
  for (const file of files) {
    const raw = await fs.readFile(path.join(dir, file), 'utf8');
    const match = raw.match(/^order:\s*(\d+)/m);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

export async function produce(briefPath: string, dryRun: boolean) {
  loadEnv();
  const brief = briefSchema.parse(parse(await fs.readFile(briefPath, 'utf8')));
  for (const idea of brief.ideas) assertOriginal(`${idea.title} ${idea.prompt}`);
  const pending: Idea[] = [];
  for (const idea of brief.ideas) {
    const sheetFile = path.join(sheetContentRoot, brief.slug, `${idea.slug}.md`);
    try {
      await fs.access(sheetFile);
      console.log(`уже на сайте: ${brief.slug}/${idea.slug}`);
    } catch {
      pending.push(idea);
    }
  }
  if (!pending.length) {
    console.log('Новых страниц в задании нет. Подборка уже собрана.');
    return;
  }
  console.log(`Ждут генерации: ${pending.map((idea) => idea.slug).join(', ')}`);
  if (dryRun) return;
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('Нет OPENROUTER_API_KEY. Добавьте ключ в factory/.env и запустите команду снова.');
  }
  const site = readSite();
  let order = await nextOrder(brief.slug);
  const created: { title: string; slug: string }[] = [];
  for (const idea of pending) {
    console.log(`рисую ${idea.slug}...`);
    const raw = await generateColoringPage(coloringPrompt(brief.style, idea.prompt));
    const print = await stampSite(await fitPortrait(raw));
    const preview = await webPreview(print);
    const dir = path.join(printRoot, brief.slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${idea.slug}.png`), preview);
    await fs.writeFile(path.join(dir, `${idea.slug}-us-letter.pdf`), await pngToPdf(print, 'letter', idea.title, site.name));
    await fs.writeFile(path.join(dir, `${idea.slug}-a4.pdf`), await pngToPdf(print, 'a4', idea.title, site.name));
    const copy = await describeSheet(brief, idea);
    const sheetDir = path.join(sheetContentRoot, brief.slug);
    await fs.mkdir(sheetDir, { recursive: true });
    await fs.writeFile(
      path.join(sheetDir, `${idea.slug}.md`),
      sheetMarkdown(brief, idea, order, copy.parentNote, copy.description, copy.alt),
    );
    created.push({ title: idea.title, slug: idea.slug });
    order += 1;
    console.log(`страница ${brief.slug}/${idea.slug}`);
  }
  const existingSheets = await fs.readdir(path.join(sheetContentRoot, brief.slug));
  const known = existingSheets.filter((name) => name.endsWith('.md')).map((name) => {
    const slug = name.replace(/\.md$/, '');
    return { title: slug, slug };
  });
  await ensureTheme(brief, known);
  await buildPins();
  console.log(`Готово. Новых страниц: ${created.length}. Они появятся в подборке после сборки сайта.`);
}
