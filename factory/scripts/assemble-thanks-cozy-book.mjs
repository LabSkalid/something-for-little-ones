/**
 * Build one coherent Cute & Cozy Thanksgiving book (ages 4–8, medium scene density).
 * Resumable: skips scene files that already exist in scenes-redrawn/.
 * Never deletes source art.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../src/env.ts';
import { coloringPrompt, generateColoringPage } from '../src/openrouter.ts';
import { fitPortrait } from '../src/lineart.ts';
import { buildKdpBook } from '../src/kdp-book.ts';

loadEnv();

const root = 'D:/KIDS/factory/out/kdp';
const changes = path.join(root, 'thanksgiving-feast-book-FOR-CHANGES');
const yesDir = path.join(changes, 'yes');
const fillDir = path.join(changes, 'fill');
const archive = path.join(root, 'thanksgiving-archive-keep');
const scenesDir = path.join(changes, 'scenes-redrawn');
const bookDir = path.join(root, 'thanksgiving-cozy-book');
const interiorDir = path.join(bookDir, 'interior');

const style = [
  'Cute bold-and-easy kids coloring book for ages 4 to 8, cozy Thanksgiving / autumn.',
  'MEDIUM scene density: main subject PLUS a clear setting (ground, grass, porch, patch, room corner, or tree).',
  'About as busy as a friendly scarecrow in a small pumpkin patch: hero + several props, not empty white void, not a packed 20-object feast.',
  'Thick even black outlines only. Pure white background. No shading, hatching, gray, text, banners, logos, or page frame.',
  'No pilgrims, no Native American costumes, no Mayflower.',
  'Living cute turkey characters are fine. Roast/cooked turkey meat only if the subject explicitly asks for a dinner scene.',
  'No animals cooking meat.',
].join(' ');

const sceneRedraws = [
  {
    from: 'A-01-cute-turkey-with-pumpkins-leaves.png',
    slug: 'turkey-in-pumpkin-patch',
    subject:
      'A cute living turkey standing in a pumpkin patch: grass ground line, 3–4 pumpkins, autumn leaves on the ground, simple fence in the back. Friendly farm scene. NOT floating on empty white. NOT cooked turkey.',
  },
  {
    from: 'A-02-cute-turkey-harvest-vegetables.png',
    slug: 'turkey-with-garden-basket',
    subject:
      'A cute living turkey in a garden holding or beside a harvest basket of corn and carrots, pumpkins on the grass, a bit of fence. Ground and setting visible. NOT roast turkey.',
  },
  {
    from: 'A-03-cute-turkey-on-farm.png',
    slug: 'turkey-by-barn',
    subject:
      'A cute living turkey on a farm: grass, a simple barn, fence, two pumpkins. Clear outdoor scene. NOT floating. NOT food turkey.',
  },
  {
    from: 'A-04-cute-turkey-in-tree.png',
    slug: 'turkey-in-autumn-tree',
    subject:
      'A cute living turkey in an autumn tree with a thick trunk, branches, falling leaves, and grass below. Full small scene. NOT empty background.',
  },
  {
    from: 'A-05-cute-turkey-pumpkins-corn.png',
    slug: 'turkey-cornfield-edge',
    subject:
      'A cute living turkey at the edge of a cornfield with pumpkins and grass. Simple farm scene with ground. NOT cooked.',
  },
  {
    from: 'A-06-cute-turkey-with-cornucopia.png',
    slug: 'turkey-harvest-porch',
    subject:
      'A cute living turkey on a harvest porch next to a cornucopia of produce and pumpkins. Wooden porch boards visible. Cozy autumn scene. NOT roast turkey on a platter.',
  },
  {
    from: 'C-11-raccoon-with-autumn-leaves.png',
    slug: 'raccoon-in-leaf-pile',
    subject:
      'A cute raccoon sitting in a big pile of autumn leaves on the ground, one small pumpkin beside it, trees suggested behind. Ground scene, not floating.',
  },
  {
    from: 'C-12-raccoon-sweeping-leaves.png',
    slug: 'raccoon-yard-sweeping',
    subject:
      'A cute raccoon sweeping leaves in a yard: grass, leaf pile, broom, maybe a fence and tiny pumpkin. Clear outdoor setting.',
  },
  {
    from: 'C-13-squirrel-with-acorns.png',
    slug: 'squirrel-under-oak',
    subject:
      'A cute squirrel under an oak tree with acorns and leaves on the ground. Tree trunk and grass visible. Not floating.',
  },
  {
    from: 'C-14-squirrel-harvest-basket.png',
    slug: 'squirrel-garden-basket',
    subject:
      'A cute squirrel beside a harvest basket in a garden with pumpkins and grass. Small outdoor scene.',
  },
  {
    from: 'C-15-owl-on-autumn-branch.png',
    slug: 'owl-autumn-tree',
    subject:
      'A cute owl on a thick autumn tree branch with leaves; tree trunk continues down, a few leaves falling. Full nature scene, not a lone owl on white.',
  },
  {
    from: 'C-16-dog-by-fireplace-pumpkin.png',
    slug: 'dog-cozy-hearth',
    subject:
      'A cute dog by a fireplace in a cozy room: hearth, rug, pumpkin, window with autumn view. Indoor scene with floor and walls suggested. No roast turkey dinner.',
  },
  {
    from: 'C-18-fox-with-autumn-leaves.png',
    slug: 'fox-autumn-clearing',
    subject:
      'A cute fox in an autumn forest clearing: grass, leaves, a stump or small pumpkin, trees behind. Grounded scene.',
  },
  {
    from: 'B-09-autumn-maple-leaves.png',
    slug: 'leaves-on-garden-path',
    subject:
      'Autumn maple and oak leaves scattered on a simple garden path with grass edges and a tiny pumpkin. A small nature scene, not leaves floating alone on empty white.',
  },
];

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === '_before-fix') continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) copyTree(from, to);
    else if (name.endsWith('.png') || name.endsWith('.json') || name.endsWith('.txt')) {
      fs.copyFileSync(from, to);
    }
  }
}

async function withRetry(fn, label, tries = 4) {
  let last;
  for (let t = 1; t <= tries; t++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      console.log(`  retry ${t}/${tries} ${label}: ${e.message || e}`);
      await new Promise((r) => setTimeout(r, 2000 * t));
    }
  }
  throw last;
}

if (!fs.existsSync(path.join(archive, 'yes'))) {
  console.log('Archiving yes/ + fill/...');
  fs.mkdirSync(archive, { recursive: true });
  copyTree(yesDir, path.join(archive, 'yes'));
  copyTree(fillDir, path.join(archive, 'fill'));
} else {
  console.log('Archive already present, skip copy.');
}

fs.mkdirSync(scenesDir, { recursive: true });
const sceneFiles = {};
for (const [i, page] of sceneRedraws.entries()) {
  const outName = `${String(i + 1).padStart(2, '0')}-${page.slug}.png`;
  const outFile = path.join(scenesDir, outName);
  sceneFiles[page.from] = outFile;
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 50_000) {
    console.log(`[scenes ${i + 1}/${sceneRedraws.length}] ${outName} (exists, skip)`);
    continue;
  }
  console.log(`[scenes ${i + 1}/${sceneRedraws.length}] ${outName}`);
  await withRetry(async () => {
    const prompt = coloringPrompt(style, page.subject, 'easy', '4-6');
    const raw = await generateColoringPage(prompt);
    const print = await fitPortrait(raw);
    await fs.promises.writeFile(outFile, print);
  }, outName);
  console.log('  ok');
}

const bookOrder = [
  { src: () => sceneFiles['A-03-cute-turkey-on-farm.png'], caption: 'Turkey on the farm' },
  { src: () => path.join(fillDir, 'B-08-pumpkins-in-autumn-forest.png'), caption: 'Pumpkins in the woods' },
  { src: () => sceneFiles['C-11-raccoon-with-autumn-leaves.png'], caption: 'Raccoon in the leaves' },
  { src: () => sceneFiles['A-01-cute-turkey-with-pumpkins-leaves.png'], caption: 'Turkey in the pumpkin patch' },
  { src: () => path.join(yesDir, '09-p09-scarecrow-and-pumpkins.png'), caption: 'Scarecrow' },
  { src: () => sceneFiles['C-13-squirrel-with-acorns.png'], caption: 'Squirrel with acorns' },
  { src: () => path.join(fillDir, 'B-07-cozy-room-with-pumpkins.png'), caption: 'Cozy pumpkins' },
  { src: () => sceneFiles['A-02-cute-turkey-harvest-vegetables.png'], caption: 'Turkey with a harvest basket' },
  { src: () => path.join(fillDir, 'B-17-wheelbarrow-of-pumpkins.png'), caption: 'Wheelbarrow of pumpkins' },
  { src: () => sceneFiles['C-18-fox-with-autumn-leaves.png'], caption: 'Fox in autumn' },
  { src: () => path.join(yesDir, '23-p23-basket-of-pumpkins-and-apples.png'), caption: 'Basket of pumpkins' },
  { src: () => sceneFiles['A-05-cute-turkey-pumpkins-corn.png'], caption: 'Turkey by the corn' },
  { src: () => sceneFiles['C-15-owl-on-autumn-branch.png'], caption: 'Autumn owl' },
  { src: () => path.join(yesDir, '17-p17-cornucopia-with-fruit-and-vegetables.png'), caption: 'Cornucopia' },
  { src: () => sceneFiles['C-16-dog-by-fireplace-pumpkin.png'], caption: 'Dog by the fire' },
  { src: () => path.join(yesDir, '06-p06-candles-and-flowers.png'), caption: 'Autumn candles' },
  { src: () => sceneFiles['A-06-cute-turkey-with-cornucopia.png'], caption: 'Turkey on the porch' },
  { src: () => path.join(fillDir, 'B-10-fall-pumpkin-wreath.png'), caption: 'Fall wreath' },
  { src: () => sceneFiles['C-12-raccoon-sweeping-leaves.png'], caption: 'Raccoon sweeping' },
  { src: () => sceneFiles['B-09-autumn-maple-leaves.png'], caption: 'Leaves on the path' },
  { src: () => sceneFiles['C-14-squirrel-harvest-basket.png'], caption: 'Squirrel garden' },
  { src: () => sceneFiles['A-04-cute-turkey-in-tree.png'], caption: 'Turkey in the tree' },
  { src: () => path.join(yesDir, '31-p31-table-centerpiece-with-candles.png'), caption: 'Centerpiece' },
  { src: () => path.join(yesDir, '10-p10-mashed-potatoes.png'), caption: 'Mashed potatoes' },
  { src: () => path.join(yesDir, '04-p04-mother-and-daughter-baking-pies.png'), caption: 'Baking pies' },
  { src: () => path.join(yesDir, '29-p29-pie-with-ice-cream.png'), caption: 'Pie and ice cream' },
  { src: () => path.join(yesDir, '22-p22-plate-of-food-with-cutlery.png'), caption: 'Dinner plate' },
  { src: () => path.join(yesDir, '33-p33-pie-cupcake-cookies-in-heart.png'), caption: 'Sweet treats' },
  { src: () => path.join(yesDir, '01-p01-thanksgiving-feast-with-turkey-and-pies.png'), caption: 'Feast sides' },
  { src: () => path.join(yesDir, '02-p02-family-thanksgiving-dinner.png'), caption: 'Family dinner' },
];

if (fs.existsSync(interiorDir)) fs.rmSync(interiorDir, { recursive: true, force: true });
fs.mkdirSync(interiorDir, { recursive: true });

const manifest = [];
for (const [i, page] of bookOrder.entries()) {
  const src = page.src();
  if (!src || !fs.existsSync(src)) throw new Error(`Missing page source for ${page.caption}: ${src}`);
  const n = String(i + 1).padStart(2, '0');
  const slug = page.caption.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const destName = `page-${n}-${slug}.png`;
  fs.copyFileSync(src, path.join(interiorDir, destName));
  manifest.push({ index: i + 1, file: destName, caption: page.caption, source: src });
  console.log(`book ${destName}`);
}

fs.mkdirSync(bookDir, { recursive: true });
fs.writeFileSync(
  path.join(bookDir, 'manifest.json'),
  JSON.stringify(
    {
      title: 'Cute & Cozy Thanksgiving Coloring Book',
      audience: 'Ages 4–8, bold & easy cozy scenes',
      pages: manifest.length,
      interior: interiorDir,
      archive,
      note: 'Originals kept in thanksgiving-archive-keep and FOR-CHANGES. Nothing deleted.',
      pagesDetail: manifest,
    },
    null,
    2,
  ),
);
fs.writeFileSync(
  path.join(bookDir, 'README.txt'),
  [
    'Cute & Cozy Thanksgiving Coloring Book',
    'Audience: ages 4–8 (parent + child), medium scene density',
    `Art pages: ${manifest.length}`,
    `Interior: ${interiorDir}`,
    `Archive: ${archive}`,
  ].join('\n'),
);

console.log('Building KDP interior PDF...');
await buildKdpBook({
  folder: interiorDir,
  title: 'Cute & Cozy Thanksgiving Coloring Book',
  subtitle: 'Bold & Easy Autumn Fun for Kids',
  author: 'Something for Little Ones',
  outFile: path.join(bookDir, 'Cute-Cozy-Thanksgiving-KDP-interior.pdf'),
  blankBacks: true,
  padEvenPages: true,
  frontMatter: true,
  captions: true,
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
  frontMatter: true,
  captions: true,
  encodePreset: 'download',
});

console.log('DONE');
console.log('Book:', bookDir);
console.log('Pages:', manifest.length);
