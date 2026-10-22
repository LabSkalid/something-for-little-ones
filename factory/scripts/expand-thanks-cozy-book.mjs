/**
 * Expand cozy Thanksgiving book to 50 art pages.
 * - Replace weak pages 26–27 (pie / dinner plate)
 * - Add festival, tractor, haystacks, nature, extra cornucopias
 * - Rebuild PDFs: NO front-matter title page, NO captions
 * - Never deletes: weak pages go to archive/replaced/
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../src/env.ts';
import { coloringPrompt, generateColoringPage } from '../src/openrouter.ts';
import { fitPortrait } from '../src/lineart.ts';
import { buildKdpBook } from '../src/kdp-book.ts';

loadEnv();

const root = 'D:/KIDS/factory/out/kdp';
const bookDir = path.join(root, 'thanksgiving-cozy-book');
const interiorDir = path.join(bookDir, 'interior');
const expandDir = path.join(root, 'thanksgiving-feast-book-FOR-CHANGES', 'expand-50');
const replacedArchive = path.join(root, 'thanksgiving-archive-keep', 'replaced-weak');
const yesDir = path.join(root, 'thanksgiving-feast-book-FOR-CHANGES', 'yes');
const fillDir = path.join(root, 'thanksgiving-feast-book-FOR-CHANGES', 'fill');
const scenesDir = path.join(root, 'thanksgiving-feast-book-FOR-CHANGES', 'scenes-redrawn');

const style = [
  'Cute bold-and-easy kids coloring book for ages 4 to 8, cozy Thanksgiving / autumn harvest.',
  'MEDIUM scene density: clear setting with ground or environment — not empty white void, not a packed hyper-detailed feast.',
  'Thick even black outlines only. Pure white background. No shading, hatching, gray.',
  'No text, letters, numbers, captions, banners, signs with words, logos, or page frames.',
  'No pilgrims, no Native American costumes, no Mayflower.',
  'Living cute animals OK. Roast turkey only if subject is explicitly a dinner scene.',
  'No animals cooking meat.',
].join(' ');

/** New + replacement pages */
const newPages = [
  // Replacements for weak 26–27
  {
    slug: 'harvest-festival-fair',
    subject:
      'A cheerful autumn harvest festival: a few booths with pumpkins and pies, bunting flags without letters, children-friendly fair scene, ground and sky. Cozy thanksgiving fair. No text on signs.',
  },
  {
    slug: 'pumpkin-pie-on-windowsill',
    subject:
      'A cozy kitchen window with a pumpkin pie cooling on the sill, curtains, autumn trees outside, a small plant. Warm indoor scene. No roast turkey. No text.',
  },

  // Requested themes
  {
    slug: 'tractor-in-pumpkin-field',
    subject:
      'A friendly farm tractor in a pumpkin field with hay and autumn trees. Clear ground and fields. Cute bold easy. No text.',
  },
  {
    slug: 'haystacks-in-autumn-field',
    subject:
      'Round haystacks in an autumn farm field, path, distant trees, a few pumpkins. Peaceful harvest landscape. No text.',
  },
  {
    slug: 'cornucopia-horn-of-plenty',
    subject:
      'A large classic cornucopia horn of plenty overflowing with pumpkins, corn, grapes, apples on a simple tablecloth or grass. Harvest still-life scene. No meat turkey. No text.',
  },
  {
    slug: 'second-cornucopia-porch',
    subject:
      'A cornucopia on a harvest porch with pumpkins and autumn leaves, wooden boards visible. Cozy outdoor still life. No text.',
  },
  {
    slug: 'autumn-forest-path',
    subject:
      'A winding autumn forest path with maple trees, falling leaves, a stump and mushrooms. Nature scene for kids. No text.',
  },
  {
    slug: 'lake-with-autumn-trees',
    subject:
      'A calm lake with autumn trees on the shore, a small dock or rocks, fallen leaves. Peaceful nature. No text.',
  },
  {
    slug: 'sunflower-and-pumpkin-field',
    subject:
      'A field of tall sunflowers with pumpkins at the base and a simple fence. Bright autumn farm nature. No text.',
  },
  {
    slug: 'covered-bridge-autumn',
    subject:
      'A cute covered wooden bridge over a creek in autumn, trees with leaves, path. Cozy countryside. No text.',
  },
  {
    slug: 'farm-market-stall',
    subject:
      'A harvest market stall piled with pumpkins, apples, and corn, striped awning without writing. Festival market vibe. No letters on signs.',
  },
  {
    slug: 'hot-cocoa-harvest-table',
    subject:
      'A small outdoor harvest table with two mugs of hot cocoa, cookies, and a mini pumpkin, autumn leaves around. Cozy snack scene. No roast turkey. No text.',
  },
  {
    slug: 'maple-tree-swing',
    subject:
      'A tree swing hanging from a big maple tree in autumn, leaves on the ground, pumpkins nearby. Playful nature. No text.',
  },
  {
    slug: 'barn-and-silo-autumn',
    subject:
      'A red-style barn and silo on a farm hill with hay bales and autumn trees. Simple landscape. No text.',
  },
  {
    slug: 'corn-maze-entrance',
    subject:
      'The entrance to a corn maze with tall corn stalks, a wooden arch without words, pumpkins beside it. Fun harvest festival. No text.',
  },
  {
    slug: 'apple-orchard-ladder',
    subject:
      'An apple orchard with a wooden ladder against a tree, basket of apples, autumn leaves. Nature harvest. No text.',
  },
  {
    slug: 'river-and-autumn-hills',
    subject:
      'A gentle river through rolling autumn hills with trees and a small bridge. Nature landscape. No text.',
  },
  {
    slug: 'campfire-marshmallows-autumn',
    subject:
      'A cozy campfire with marshmallow sticks, log seats, autumn trees around. Outdoor fall evening. No turkey dinner. No text.',
  },
  {
    slug: 'pumpkin-patch-wagon',
    subject:
      'A wooden wagon loaded with pumpkins in a big pumpkin patch, fence and trees. Classic harvest. No text.',
  },
  {
    slug: 'windmill-and-hay',
    subject:
      'A farm windmill beside haystacks and a field path in autumn. Countryside nature. No text.',
  },
  {
    slug: 'birdhouse-autumn-garden',
    subject:
      'A garden with a birdhouse on a post, autumn flowers, pumpkins and fallen leaves. Gentle nature. No text.',
  },
  {
    slug: 'deer-in-autumn-meadow',
    subject:
      'A gentle deer in an autumn meadow with tall grass, falling leaves, distant trees. Peaceful nature. No text.',
  },
];

async function withRetry(fn, label, tries = 4) {
  let last;
  for (let t = 1; t <= tries; t++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      console.log(`  retry ${t}/${tries} ${label}: ${e.message || e}`);
      await new Promise((r) => setTimeout(r, 2500 * t));
    }
  }
  throw last;
}

fs.mkdirSync(expandDir, { recursive: true });
fs.mkdirSync(replacedArchive, { recursive: true });

// Archive weak pages 26–27 if present
for (const weak of ['page-26-pie-and-ice-cream.png', 'page-27-dinner-plate.png']) {
  const p = path.join(interiorDir, weak);
  if (fs.existsSync(p)) {
    fs.copyFileSync(p, path.join(replacedArchive, weak));
    console.log('archived weak', weak);
  }
}

const generated = [];
for (const [i, page] of newPages.entries()) {
  const name = `${String(i + 1).padStart(2, '0')}-${page.slug}.png`;
  const outFile = path.join(expandDir, name);
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 50_000) {
    console.log(`[${i + 1}/${newPages.length}] ${name} (exists)`);
    generated.push({ file: outFile, slug: page.slug });
    continue;
  }
  console.log(`[${i + 1}/${newPages.length}] ${name}`);
  await withRetry(async () => {
    const prompt = coloringPrompt(style, page.subject, 'easy', '4-6');
    const raw = await generateColoringPage(prompt);
    const print = await fitPortrait(raw);
    await fs.promises.writeFile(outFile, print);
  }, name);
  generated.push({ file: outFile, slug: page.slug });
  console.log('  ok');
}

// Keep strong core from previous book (skip old 26–27), then add all new pages → 50
const keepFromOld = [
  'page-01-turkey-on-the-farm.png',
  'page-02-pumpkins-in-the-woods.png',
  'page-03-raccoon-in-the-leaves.png',
  'page-04-turkey-in-the-pumpkin-patch.png',
  'page-05-scarecrow.png',
  'page-06-squirrel-with-acorns.png',
  'page-07-cozy-pumpkins.png',
  'page-08-turkey-with-a-harvest-basket.png',
  'page-09-wheelbarrow-of-pumpkins.png',
  'page-10-fox-in-autumn.png',
  'page-11-basket-of-pumpkins.png',
  'page-12-turkey-by-the-corn.png',
  'page-13-autumn-owl.png',
  'page-14-cornucopia.png',
  'page-15-dog-by-the-fire.png',
  'page-16-autumn-candles.png',
  'page-17-turkey-on-the-porch.png',
  'page-18-fall-wreath.png',
  'page-19-raccoon-sweeping.png',
  'page-20-leaves-on-the-path.png',
  'page-21-squirrel-garden.png',
  'page-22-turkey-in-the-tree.png',
  'page-23-centerpiece.png',
  'page-24-mashed-potatoes.png',
  'page-25-baking-pies.png',
  // 26–27 replaced
  'page-28-sweet-treats.png',
  'page-29-feast-sides.png',
  'page-30-family-dinner.png',
];

const finalSources = [
  ...keepFromOld.map((f) => ({ file: path.join(interiorDir, f), slug: f.replace(/^page-\d+-/, '').replace(/\.png$/, '') })),
  ...generated,
];

if (finalSources.length < 50) {
  // pad from unused yes cornucopia / extras if somehow short
  const extras = [
    path.join(yesDir, '30-p30-cornucopia-with-pumpkins-and-corn.png'),
    path.join(yesDir, '34-p34-cornucopia-with-fruit-and-pumpkin.png'),
  ];
  for (const ex of extras) {
    if (finalSources.length >= 50) break;
    if (fs.existsSync(ex)) finalSources.push({ file: ex, slug: path.basename(ex, '.png') });
  }
}

const take = finalSources.slice(0, 50);
console.log('Assembling', take.length, 'pages...');

const staging = path.join(bookDir, 'interior-next');
if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

const manifest = [];
for (const [i, page] of take.entries()) {
  const n = String(i + 1).padStart(2, '0');
  const slug = page.slug.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40);
  const dest = `page-${n}-${slug || 'art'}.png`;
  if (!fs.existsSync(page.file)) throw new Error(`Missing ${page.file}`);
  fs.copyFileSync(page.file, path.join(staging, dest));
  manifest.push({ index: i + 1, file: dest, source: page.file });
}

// Swap interiors
const bakInterior = path.join(bookDir, 'interior-before-50');
if (fs.existsSync(bakInterior)) fs.rmSync(bakInterior, { recursive: true, force: true });
if (fs.existsSync(interiorDir)) fs.renameSync(interiorDir, bakInterior);
fs.renameSync(staging, interiorDir);

fs.writeFileSync(
  path.join(bookDir, 'manifest.json'),
  JSON.stringify(
    {
      title: 'Cute & Cozy Thanksgiving Coloring Book',
      audience: 'Ages 4–8',
      pages: manifest.length,
      noCaptions: true,
      noFrontMatter: true,
      pagesDetail: manifest,
    },
    null,
    2,
  ),
);

console.log('Building KDP PDF (no title page, no captions)...');
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

console.log('Building download PDF...');
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

console.log('DONE pages=', manifest.length);
console.log(bookDir);
