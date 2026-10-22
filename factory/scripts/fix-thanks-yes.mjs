/**
 * Fix FOR-CHANGES/yes pages:
 * - Roast / whole turkey on the table ONLY on p02 (left untouched).
 * - p09: scarecrow in a field only — no dinner table.
 * Writes into the same yes folder (with .bak next to originals once).
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../src/env.ts';
import { coloringPrompt, generateColoringPage } from '../src/openrouter.ts';
import { fitPortrait } from '../src/lineart.ts';

loadEnv();

const yesDir = 'D:/KIDS/factory/out/kdp/thanksgiving-feast-book-FOR-CHANGES/yes';
const bakDir = path.join(yesDir, '_before-fix');

const style = [
  'Cute bold-and-easy kids coloring-book line art, same cozy Thanksgiving feast series.',
  'Thick even black outlines, pure white background, no shading, no hatching, no gray, no text, no frame, no border.',
  'Closed shapes a child can color. Modern cozy home / harvest vibe.',
  'No pilgrims, no Native American costumes, no living turkey characters.',
].join(' ');

/** Per-file subject. Omit roast turkey unless explicitly wanted. */
const subjects = {
  '01-p01-thanksgiving-feast-with-turkey-and-pies.png':
    'A cozy Thanksgiving dessert and sides table: lattice pie, pumpkin pie, mashed potatoes with butter, gravy boat, rolls, cranberry bowl, cornucopia of fruit nearby. NO roast turkey, NO whole cooked turkey, NO turkey platter, NO turkey anywhere.',
  '04-p04-mother-and-daughter-baking-pies.png':
    'Mother and daughter baking pumpkin pies in a cozy kitchen: rolling pin, pie crusts, pumpkins, mixing bowl. Warm and simple. NO roast turkey, NO cooked turkey on a platter.',
  '06-p06-candles-and-flowers.png':
    'A simple autumn candle and flower centerpiece with leaves and a small pumpkin. Quiet cozy still life. NO food turkey, NO dinner table feast, NO roast turkey.',
  '09-p09-scarecrow-and-pumpkins.png':
    'A friendly scarecrow standing in a pumpkin patch / harvest field with pumpkins and autumn leaves around it. Outdoor farm field only. NO dining table, NO indoor room, NO feast, NO roast turkey, NO plates of food.',
  '10-p10-mashed-potatoes.png':
    'One big bowl of mashed potatoes with a pat of butter and a spoon, maybe a small gravy boat beside it. Simple food still life. NO roast turkey, NO whole turkey.',
  '17-p17-cornucopia-with-fruit-and-vegetables.png':
    'A cornucopia horn of plenty overflowing with fruit and vegetables: apples, grapes, corn, carrots, pumpkins. Harvest still life. NO roast turkey, NO meat.',
  '22-p22-plate-of-food-with-cutlery.png':
    'A single dinner plate with autumn sides only: mashed potatoes, peas or cranberries, a roll, fork and knife. NO roast turkey, NO turkey leg, NO meat on the plate.',
  '23-p23-basket-of-pumpkins-and-apples.png':
    'A harvest basket filled with pumpkins and apples, a few autumn leaves. Simple outdoor or porch still life. NO turkey, NO dinner table.',
  '29-p29-pie-with-ice-cream.png':
    'A slice or whole pie with a scoop of ice cream, maybe a fork. Sweet dessert close-up. NO roast turkey, NO savory feast.',
  '30-p30-cornucopia-with-pumpkins-and-corn.png':
    'A cornucopia with pumpkins, corn, and autumn produce. Harvest still life. NO roast turkey, NO meat.',
  '31-p31-table-centerpiece-with-candles.png':
    'An autumn table centerpiece: candles, leaves, small pumpkins, maybe flowers. No full feast. NO roast turkey, NO turkey platter.',
  '33-p33-pie-cupcake-cookies-in-heart.png':
    'Sweet treats arrangement: pie, cupcakes, cookies. Dessert focus. NO roast turkey, NO meat.',
  '34-p34-cornucopia-with-fruit-and-pumpkin.png':
    'A cornucopia with fruit and a pumpkin. Clean harvest still life. NO roast turkey, NO meat.',
};

const skip = new Set(['02-p02-family-thanksgiving-dinner.png']); // turkey stays here

fs.mkdirSync(bakDir, { recursive: true });

const files = fs.readdirSync(yesDir).filter((f) => f.endsWith('.png'));
const todo = files.filter((f) => subjects[f] && !skip.has(f));
console.log(`Fix ${todo.length} pages in yes/ (skip p02 with turkey). Backup → ${bakDir}`);

for (const [i, name] of todo.entries()) {
  const src = path.join(yesDir, name);
  const bak = path.join(bakDir, name);
  if (!fs.existsSync(bak)) fs.copyFileSync(src, bak);

  const subject = subjects[name];
  console.log(`[${i + 1}/${todo.length}] ${name}`);
  const prompt = coloringPrompt(style, subject, 'easy', '4-6');
  const raw = await generateColoringPage(prompt);
  const print = await fitPortrait(raw);
  await fs.promises.writeFile(src, print);
  console.log('  updated');
}

console.log('DONE. p02 left as-is. Backups in yes/_before-fix/');
