import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { site } from './src/site';
import { contentLastmods } from './src/lib/sitemap-lastmod';

const lastmods = contentLastmods();

const oldFairyTales = '/fairy-tails-coloring-pages';
const newFairyTales = '/fairy-tales-coloring-pages';
const fairyTaleSlugs = [
  'beauty-and-the-beast',
  'aladdin-and-the-magic-lamp',
  'snow-white-and-the-seven-dwarfs',
  'goldilocks-and-the-three-bears',
  'the-nutcracker',
  'alice-in-wonderland',
  'cinderella-sweeping-floor',
  'cinderella-by-fireplace',
];
const fairyTaleRenames: [string, string][] = [
  ['snow-white-classic-fairy-tail', 'snow-white-classic-fairy-tale'],
  ['pinocchio-classic-fairy-tail', 'pinocchio-classic-fairy-tale'],
  ['gingerbread-man-classic-fairy-tail', 'gingerbread-man-classic-fairy-tale'],
  ['the-ugly-duckling-classic-fairy-tail', 'the-ugly-duckling-classic-fairy-tale'],
  ['goldilocks-and-the-three-bears-classic-fairy-tai', 'goldilocks-and-the-three-bears-classic-fairy-tale'],
  ['three-little-pigs-classic-fairy-tail', 'three-little-pigs-classic-fairy-tale'],
  ['little-red-riding-hood-classic-fairy-tail', 'little-red-riding-hood-classic-fairy-tale'],
  ['puss-in-boots-classic-fairy-tail', 'puss-in-boots-classic-fairy-tale'],
  ['hansel-and-gretel-classic-fairy-tail', 'hansel-and-gretel-classic-fairy-tale'],
  ['sleeping-beauty-classic-fairy-tail', 'sleeping-beauty-classic-fairy-tale'],
  ['rapunzel-classic-fairy-tail', 'rapunzel-classic-fairy-tale'],
  ['jack-and-the-beanstalk-classic-fairy-tail', 'jack-and-the-beanstalk-classic-fairy-tale'],
  ['the-little-mermaid-classic-fairy-tail', 'the-little-mermaid-classic-fairy-tale'],
];
const fairyTaleRedirects: Record<string, string> = {
  [`${oldFairyTales}/`]: `${newFairyTales}/`,
};
for (const slug of fairyTaleSlugs) {
  fairyTaleRedirects[`${oldFairyTales}/${slug}/`] = `${newFairyTales}/${slug}/`;
}
for (const [from, to] of fairyTaleRenames) {
  fairyTaleRedirects[`${oldFairyTales}/${from}/`] = `${newFairyTales}/${to}/`;
}
const oceanMoves = ['fish-and-seaweed', 'clownfish-and-seaweed', 'two-seahorses-underwater'];
for (const slug of oceanMoves) {
  fairyTaleRedirects[`/animal-coloring-pages/${slug}/`] = `/ocean-scene-coloring-pages/${slug}/`;
}

const dinosaurSceneSheetRenames: [string, string][] = [
  ['dinosaur-watering-flower', 'dinosaur-sunny-mountain-garden'],
  ['dinosaur-watering-flowers', 'dinosaur-woodland-garden'],
  ['dinosaur-watering-flowers-2', 'dinosaur-hillside-garden'],
];
for (const [from, to] of dinosaurSceneSheetRenames) {
  fairyTaleRedirects[`/dinosaur-scene-coloring-pages/${from}/`] = `/dinosaur-scene-coloring-pages/${to}/`;
}

const themeRenames: [string, string][] = [
  ['valentine-s-day-coloring-pages', 'valentines-day-coloring-pages'],
  ['st-patrick-s-day-coloring-pages', 'st-patricks-day-coloring-pages'],
];
const sheetRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src', 'content', 'sheets');
for (const [from, to] of themeRenames) {
  fairyTaleRedirects[`/${from}/`] = `/${to}/`;
  let names: string[] = [];
  try {
    names = fsSync.readdirSync(path.join(sheetRoot, to));
  } catch {
    names = [];
  }
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const sheet = name.slice(0, -3);
    fairyTaleRedirects[`/${from}/${sheet}/`] = `/${to}/${sheet}/`;
  }
}
const pinDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'pins');
let pinNames: string[] = [];
try {
  pinNames = fsSync.readdirSync(pinDir);
} catch {
  pinNames = [];
}
for (const [from, to] of themeRenames) {
  for (const name of pinNames) {
    if (!name.startsWith(`${to}-`) && !name.startsWith(`${to}.`)) continue;
    const oldName = `${from}${name.slice(to.length)}`;
    fairyTaleRedirects[`/pins/${oldName}`] = `/pins/${name}`;
  }
}

export default defineConfig({
  site: site.url,
  trailingSlash: 'always',
  redirects: fairyTaleRedirects,
  integrations: [
    sitemap({
      filter: (page) => {
        const pathname = new URL(page).pathname;
        return pathname !== '/404/' && pathname !== '/404';
      },
      serialize(item) {
        let pathname = new URL(item.url).pathname;
        if (pathname !== '/' && !pathname.endsWith('/')) pathname += '/';
        const lastmod = lastmods.get(pathname);
        if (lastmod) item.lastmod = lastmod;
        return item;
      },
    }),
    {
      name: 'sitemap-xml',
      hooks: {
        'astro:build:done': async ({ dir }) => {
          const names = await fs.readdir(dir);
          const parts = names.filter((name) => /^sitemap-\d+\.xml$/.test(name)).sort();
          if (parts.length !== 1) {
            throw new Error(`sitemap.xml needs one generated urlset, found ${parts.join(', ') || 'none'}`);
          }
          await fs.copyFile(new URL(parts[0], dir), new URL('sitemap.xml', dir));
        },
      },
    },
    {
      name: 'ads-txt',
      hooks: {
        'astro:build:done': async ({ dir }) => {
          const pub = process.env.PUBLIC_ADSENSE_PUB ?? '';
          const file = new URL('ads.txt', dir);
          if (/^pub-\d+$/.test(pub)) {
            await fs.writeFile(file, `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`);
          } else {
            await fs.rm(file, { force: true });
          }
        },
      },
    },
  ],
});
