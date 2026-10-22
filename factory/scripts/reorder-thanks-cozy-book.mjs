/**
 * Re-interleave all 50 pages for Look Inside rhythm.
 * No redraw — copy only. Rebuild PDFs without captions / front matter.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../src/env.ts';
import { buildKdpBook } from '../src/kdp-book.ts';

loadEnv();

const bookDir = 'D:/KIDS/factory/out/kdp/thanksgiving-cozy-book';
const interiorDir = path.join(bookDir, 'interior');
const prevDir = path.join(bookDir, 'interior-before-reorder');

/** Desired sequence (slug fragments matching current filenames) */
const order = [
  // Open: character + nature + farm
  'turkey-on-the-farm',
  'pumpkins-in-the-woods',
  'tractor-in-pumpkin-field',
  'raccoon-in-the-leaves',
  'turkey-in-the-pumpkin-patch',
  'haystacks-in-autumn-field',
  'scarecrow',
  'autumn-forest-path',
  'squirrel-with-acorns',
  'lake-with-autumn-trees',
  // Mid: harvest + festival + animals
  'cozy-pumpkins',
  'turkey-with-a-harvest-basket',
  'harvest-festival-fair',
  'wheelbarrow-of-pumpkins',
  'fox-in-autumn',
  'sunflower-and-pumpkin-field',
  'basket-of-pumpkins',
  'cornucopia-horn-of-plenty',
  'turkey-by-the-corn',
  'covered-bridge-autumn',
  'autumn-owl',
  'farm-market-stall',
  'cornucopia', // original
  'barn-and-silo-autumn',
  'dog-by-the-fire',
  'maple-tree-swing',
  'autumn-candles',
  'turkey-on-the-porch',
  'corn-maze-entrance',
  'fall-wreath',
  'raccoon-sweeping',
  'apple-orchard-ladder',
  'leaves-on-the-path',
  'second-cornucopia-porch',
  'squirrel-garden',
  'river-and-autumn-hills',
  'turkey-in-the-tree',
  'windmill-and-hay',
  'birdhouse-autumn-garden',
  'pumpkin-patch-wagon',
  'deer-in-autumn-meadow',
  'campfire-marshmallows-autumn',
  // Close: cozy food / feast (not a dump of new pages)
  'centerpiece',
  'hot-cocoa-harvest-table',
  'mashed-potatoes',
  'pumpkin-pie-on-windowsill',
  'baking-pies',
  'sweet-treats',
  'feast-sides',
  'family-dinner',
];

const existing = fs.readdirSync(interiorDir).filter((f) => f.endsWith('.png'));
function findFile(slug) {
  const stem = (f) => f.replace(/^page-\d+-/, '').replace(/\.png$/i, '');
  const exact = existing.find((f) => stem(f) === slug);
  if (exact) return exact;
  throw new Error(`No file matching exact slug "${slug}". Have: ${existing.map(stem).join(', ')}`);
}

const sources = order.map((slug) => {
  const file = findFile(slug);
  return { slug, file, abs: path.join(interiorDir, file) };
});

if (sources.length !== 50) throw new Error(`Expected 50, got ${sources.length}`);

// Backup current order
if (fs.existsSync(prevDir)) fs.rmSync(prevDir, { recursive: true, force: true });
fs.mkdirSync(prevDir, { recursive: true });
for (const f of existing) fs.copyFileSync(path.join(interiorDir, f), path.join(prevDir, f));

const staging = path.join(bookDir, 'interior-reordered');
if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

const manifest = [];
for (const [i, page] of sources.entries()) {
  const n = String(i + 1).padStart(2, '0');
  const dest = `page-${n}-${page.slug}.png`;
  fs.copyFileSync(page.abs, path.join(staging, dest));
  manifest.push({ index: i + 1, file: dest, was: page.file });
  console.log(`${n} ${page.slug}`);
}

fs.rmSync(interiorDir, { recursive: true, force: true });
fs.renameSync(staging, interiorDir);

fs.writeFileSync(
  path.join(bookDir, 'manifest.json'),
  JSON.stringify(
    {
      title: 'Cute & Cozy Thanksgiving Coloring Book',
      audience: 'Ages 4–8',
      pages: 50,
      noCaptions: true,
      noFrontMatter: true,
      interleaved: true,
      pagesDetail: manifest,
    },
    null,
    2,
  ),
);

console.log('Building PDFs...');
await buildKdpBook({
  folder: interiorDir,
  title: 'Cute & Cozy Thanksgiving Coloring Book',
  subtitle: 'Bold & Easy Autumn Fun for Kids',
  author: 'Something for Little Ones',
  outFile: path.join(bookDir, 'Cute-Cozy-Thanksgiving-KDP-interior.pdf'),
  blankBacks: true,
  padEvenPages: true,
  frontMatter: false,
  captions: false,
});

await buildKdpBook({
  folder: interiorDir,
  title: 'Cute & Cozy Thanksgiving Coloring Book',
  subtitle: 'Bold & Easy Autumn Fun for Kids',
  author: 'Something for Little Ones',
  outFile: path.join(bookDir, 'Cute-Cozy-Thanksgiving-DOWNLOAD.pdf'),
  blankBacks: false,
  padEvenPages: false,
  frontMatter: false,
  captions: false,
  encodePreset: 'download',
});

console.log('DONE — interleaved 50 pages');
