/**
 * Draw remaining Cute & Cozy Thanksgiving pages (turkeys / harvest / woodland).
 * Does NOT touch yes/ — writes to FOR-CHANGES/fill/
 * Mix: ~6 living turkeys, ~4 harvest, ~6 woodland (revised fewer turkeys).
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../src/env.ts';
import { coloringPrompt, generateColoringPage } from '../src/openrouter.ts';
import { fitPortrait } from '../src/lineart.ts';

loadEnv();

const outDir = 'D:/KIDS/factory/out/kdp/thanksgiving-feast-book-FOR-CHANGES/fill';
fs.mkdirSync(outDir, { recursive: true });

const style = [
  'Cute bold-and-easy kids coloring-book line art for a cozy Thanksgiving / fall book.',
  'Same series style: thick even black outlines, pure white background, no shading, no hatching, no gray fill.',
  'No text, letters, banners, logos, watermarks, or decorative page frames.',
  'No pilgrims, no Native American costumes, no Mayflower, no historical costumes.',
  'No roast turkey, no cooked turkey on a platter, no turkey dinner meat (unless this subject is a LIVING cute turkey character).',
  'No animals cooking meat. Closed crayon-friendly shapes.',
].join(' ');

/** shelf + slug + subject */
const pages = [
  // A — living turkeys (friend)
  {
    shelf: 'A',
    slug: 'cute-turkey-with-pumpkins-leaves',
    subject:
      'One cute living cartoon turkey standing happily among pumpkins and autumn maple leaves. Big friendly eyes, fanned tail. Outdoor harvest patch. NOT cooked, NOT on a dinner plate.',
  },
  {
    shelf: 'A',
    slug: 'cute-turkey-harvest-vegetables',
    subject:
      'One cute living turkey with a small basket of harvest vegetables (carrots, corn, pumpkin). Friendly farm character. NOT roasted food.',
  },
  {
    shelf: 'A',
    slug: 'cute-turkey-on-farm',
    subject:
      'One cute living turkey standing on a simple farm with a barn silhouette, fence, and pumpkins. Cheerful outdoor scene. NOT food.',
  },
  {
    shelf: 'A',
    slug: 'cute-turkey-in-tree',
    subject:
      'One cute living turkey perched in a tree with autumn leaves. Simple cozy outdoor scene. NOT cooked turkey.',
  },
  {
    shelf: 'A',
    slug: 'cute-turkey-pumpkins-corn',
    subject:
      'One cute living turkey beside pumpkins and ears of corn. Happy harvest friend. NOT on a platter.',
  },
  {
    shelf: 'A',
    slug: 'cute-turkey-with-cornucopia',
    subject:
      'One cute living turkey next to a cornucopia of fruit and pumpkins. Friendly character plus harvest. NOT roast turkey meat.',
  },

  // B — harvest / autumn fill
  {
    shelf: 'B',
    slug: 'cozy-room-with-pumpkins',
    subject:
      'A cozy living room corner with pumpkins, a window with autumn view, maybe a candle and leaves. No people, no turkey, no dinner feast table.',
  },
  {
    shelf: 'B',
    slug: 'pumpkins-in-autumn-forest',
    subject:
      'Several cute pumpkins on a forest path among autumn trees and fallen leaves. Peaceful outdoor harvest scene. No turkey, no table.',
  },
  {
    shelf: 'B',
    slug: 'autumn-maple-leaves',
    subject:
      'A big cluster of autumn maple and oak leaves, maybe a few acorns. Simple nature still life filling the page. No turkey, no food feast.',
  },
  {
    shelf: 'B',
    slug: 'fall-pumpkin-wreath',
    subject:
      'A round autumn wreath made of leaves and small pumpkins (no words on a ribbon). Decorative harvest wreath. No turkey.',
  },

  // C — woodland helpers
  {
    shelf: 'C',
    slug: 'raccoon-with-autumn-leaves',
    subject:
      'One cute raccoon sitting among autumn leaves and a small pumpkin. Friendly woodland character. Not cooking, no feast table.',
  },
  {
    shelf: 'C',
    slug: 'raccoon-sweeping-leaves',
    subject:
      'One cute raccoon with a little broom sweeping a pile of autumn leaves. Playful outdoor scene. No turkey dinner.',
  },
  {
    shelf: 'C',
    slug: 'squirrel-with-acorns',
    subject:
      'One cute squirrel holding acorns, autumn leaves around. Simple woodland. No feast table, no turkey.',
  },
  {
    shelf: 'C',
    slug: 'squirrel-harvest-basket',
    subject:
      'One cute squirrel beside a small basket of acorns and apples, pumpkins nearby. Harvest helper. No cooked food turkey.',
  },
  {
    shelf: 'C',
    slug: 'owl-on-autumn-branch',
    subject:
      'One cute owl on a tree branch with autumn leaves. Calm woodland scene. No turkey, no dinner.',
  },
  {
    shelf: 'C',
    slug: 'dog-by-fireplace-pumpkin',
    subject:
      'One cute dog curled by a cozy fireplace with a pumpkin and leaves on the hearth. Warm indoor autumn scene. No roast turkey on a table.',
  },

  // Extra to land ~32 with the 14 yes pages
  {
    shelf: 'B',
    slug: 'wheelbarrow-of-pumpkins',
    subject:
      'A garden wheelbarrow filled with pumpkins and autumn leaves. Outdoor harvest chore scene. No turkey.',
  },
  {
    shelf: 'C',
    slug: 'fox-with-autumn-leaves',
    subject:
      'One cute fox sitting among autumn leaves and a small pumpkin. Friendly woodland. No cooking, no feast.',
  },
];

const manifest = [];
for (const [i, page] of pages.entries()) {
  const num = String(i + 1).padStart(2, '0');
  const fileName = `${page.shelf}-${num}-${page.slug}.png`;
  const outFile = path.join(outDir, fileName);
  console.log(`[${i + 1}/${pages.length}] ${fileName}`);
  const prompt = coloringPrompt(style, page.subject, 'easy', '4-6');
  const raw = await generateColoringPage(prompt);
  const print = await fitPortrait(raw);
  await fs.promises.writeFile(outFile, print);
  manifest.push({ file: fileName, shelf: page.shelf, subject: page.subject });
  console.log('  ok');
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ count: manifest.length, pages: manifest }, null, 2));
fs.writeFileSync(
  path.join(outDir, 'README.txt'),
  [
    'New fill pages for Cute & Cozy Thanksgiving',
    `Count: ${manifest.length}`,
    'Shelves: A=living turkey, B=harvest, C=woodland',
    'Combine with yes/ feast pages for full book (~32).',
    'Do not mix roast-turkey feast pages next to living-turkey heroes in page order.',
  ].join('\n'),
);

console.log('DONE', outDir, 'pages=', manifest.length);
