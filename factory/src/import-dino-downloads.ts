/**
 * Mis-labeled spring filenames in Downloads/dino — content is dinosaur scenes (ages 5–6).
 * Vision names each page; publishes to dinosaur-scene-coloring-pages only.
 */
import path from 'node:path';
import { loadEnv } from './env.ts';
import {
  listThemeSheets,
  nameDraftWithVision,
  publishDraft,
  rewriteThemeBody,
  type DraftSheet,
} from './import-stock.ts';

const DINO = 'C:\\Users\\admin\\Downloads\\dino';
const THEME = 'dinosaur-scene-coloring-pages';

const PNGS = [
  'flowering-window.png',
  'greenhouse-in-spring-a-glass-greenhouse-filled-w.png',
  'spring-cottage-a-cozy-country-cottage-with-flowe.png',
  'spring-picnic-a-picnic-blanket-with-a-basket-san.png',
];

function uniqueSlug(base: string, used: Set<string>) {
  let slug = base || 'dinosaur-scene';
  let n = 2;
  while (used.has(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  used.add(slug);
  return slug;
}

loadEnv();

const used = new Set((await listThemeSheets(THEME)).map((s) => s.slug));
let order = (await listThemeSheets(THEME)).reduce((max, s) => Math.max(max, s.order), 0);

for (let i = 0; i < PNGS.length; i += 1) {
  const file = path.join(DINO, PNGS[i]!);
  const draft: DraftSheet = {
    id: `dino-dl-${i}`,
    file,
    age: '5-6',
    slug: 'dinosaur-scene',
    title: 'Dinosaur Scene Coloring Page',
    description: '',
    alt: '',
    parentNote: '',
    include: true,
    thumb: '',
    stripFrame: false,
  };
  console.log(`↻ vision: ${PNGS[i]}`);
  const named = await nameDraftWithVision(draft);
  const slug = uniqueSlug(named.slug, used);
  order += 1;
  console.log(`  → ${slug} · ${named.title}`);
  await publishDraft(THEME, { ...named, slug, file }, order);
}

await rewriteThemeBody(THEME);
console.log(`Готово: ${PNGS.length} листа в ${THEME}. Весну не трогали.`);