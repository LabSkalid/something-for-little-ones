import fs from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { stampSite } from './footer.ts';
import { pngToPdf } from './pdf.ts';
import { loadEnv } from './env.ts';
import { generateColoringPage } from './openrouter.ts';
import { readSite } from './brand.ts';

const repo = 'D:/KIDS';
const christianRoot = 'D:/COLORING/Christian Christmass';
const printRoot = path.join(repo, 'site/public/print');
const sheetRoot = path.join(repo, 'site/src/content/sheets');

type Age = '2-3' | '3-4' | '4-5' | '5-6' | '6-8';
type Source =
  | { kind: 'svg' | 'raster'; file: string }
  | { kind: 'crop'; index: number }
  | { kind: 'redraw'; prompt: string };

type Sheet = {
  theme: string;
  slug: string;
  title: string;
  age: Age;
  description: string;
  alt: string;
  parentNote: string;
  source: Source;
};

const difficulty: Record<Age, string> = {
  '2-3': 'toddler',
  '3-4': 'easy',
  '4-5': 'medium',
  '5-6': 'medium',
  '6-8': 'detailed',
};

function q(value: string) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

async function findDir(root: string, fileName: string) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(root, entry.name, fileName);
    try {
      await fs.access(candidate);
      return path.join(root, entry.name);
    } catch {
      // keep looking
    }
  }
  throw new Error(`Could not find ${fileName} under ${root}`);
}

async function findCozy() {
  const entries = await fs.readdir('D:/COLORING', { withFileTypes: true });
  const dir = entries.find((entry) => entry.isDirectory() && entry.name.includes('Cozy'));
  if (!dir) throw new Error('Cozy folder not found');
  return path.join('D:/COLORING', dir.name, 'JPG');
}

async function flatten(file: string) {
  return sharp(file).flatten({ background: '#ffffff' }).png().toBuffer();
}

async function capSize(input: Buffer, maxLong = 2550) {
  const meta = await sharp(input).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const long = Math.max(width, height);
  if (long <= maxLong) return input;
  return sharp(input)
    .resize(maxLong, maxLong, { fit: 'inside', withoutEnlargement: true, background: '#ffffff' })
    .png()
    .toBuffer();
}

async function renderSvg(file: string) {
  const svg = await fs.readFile(file, 'utf8');
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 2000 }, background: 'white' }).render().asPng();
  return sharp(png).flatten({ background: '#ffffff' }).png().toBuffer();
}

async function splitStrip(file: string) {
  const { data, info } = await sharp(file)
    .flatten({ background: '#ffffff' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const ink = new Array<number>(width).fill(0);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * channels;
      if (data[i] < 210 || data[i + 1] < 210 || data[i + 2] < 210) count++;
    }
    ink[x] = count;
  }
  const spans: { start: number; end: number }[] = [];
  let run = -1;
  for (let x = 0; x < width; x++) {
    if (ink[x] > 3) {
      if (run < 0) run = x;
    } else if (run >= 0) {
      spans.push({ start: run, end: x });
      run = -1;
    }
  }
  if (run >= 0) spans.push({ start: run, end: width });
  let merged = spans.map((span) => ({ ...span }));
  while (merged.length > 4) {
    let best = 0;
    let bestGap = Number.POSITIVE_INFINITY;
    for (let i = 0; i < merged.length - 1; i++) {
      const gap = merged[i + 1].start - merged[i].end;
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    merged[best].end = merged[best + 1].end;
    merged.splice(best + 1, 1);
  }
  if (merged.length !== 4) {
    throw new Error(`Icon strip split into ${merged.length} pieces, expected 4`);
  }
  const crops: Buffer[] = [];
  for (const span of merged) {
    const pad = 16;
    const left = Math.max(0, span.start - pad);
    const cropWidth = Math.min(width - left, span.end - left + pad);
    const cropped = await sharp(file)
      .flatten({ background: '#ffffff' })
      .extract({ left, top: 0, width: cropWidth, height })
      .trim({ background: '#ffffff', threshold: 12 })
      .extend({ top: 36, bottom: 36, left: 36, right: 36, background: '#ffffff' })
      .png()
      .toBuffer();
    crops.push(cropped);
    const meta = await sharp(cropped).metadata();
    console.log(`crop ${crops.length} ${meta.width}x${meta.height} x=${span.start}-${span.end}`);
  }
  return crops;
}

async function preview(printPng: Buffer) {
  const meta = await sharp(printPng).metadata();
  const width = Math.min(1000, meta.width ?? 1000);
  return sharp(printPng).resize({ width, withoutEnlargement: true }).png({ compressionLevel: 9, palette: true }).toBuffer();
}

function sheetMarkdown(sheet: Sheet, order: number) {
  return `---
title: ${q(sheet.title)}
theme: ${sheet.theme}
slug: ${sheet.slug}
description: ${q(sheet.description)}
alt: ${q(sheet.alt)}
parentNote: ${q(sheet.parentNote)}
order: ${order}
difficulty: ${difficulty[sheet.age]}
age: ${q(sheet.age)}
---
`;
}

async function publish(sheet: Sheet, order: number, image: Buffer) {
  const site = readSite();
  const master = await capSize(image);
  const print = await stampSite(master);
  const web = await preview(print);
  const dir = path.join(printRoot, sheet.theme);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${sheet.slug}.png`), web);
  await fs.writeFile(path.join(dir, `${sheet.slug}-us-letter.pdf`), await pngToPdf(print, 'letter', sheet.title, site.name));
  await fs.writeFile(path.join(dir, `${sheet.slug}-a4.pdf`), await pngToPdf(print, 'a4', sheet.title, site.name));
  const contentDir = path.join(sheetRoot, sheet.theme);
  await fs.mkdir(contentDir, { recursive: true });
  await fs.writeFile(path.join(contentDir, `${sheet.slug}.md`), sheetMarkdown(sheet, order), 'utf8');
  console.log(`sheet ${sheet.theme}/${sheet.slug} age ${sheet.age}`);
}

const redrawPrompts = {
  angelStory: [
    'A finished coloring-book page for children ages 5 to 6, portrait, pure white background, solid black outlines only.',
    'Draw four panels in a two by two grid with a thick black border around each panel.',
    'Panel 1, top left: one smiling angel with a halo and wings. Under the angel, the words Good news. Spell it G-o-o-d space n-e-w-s.',
    'Panel 2, top right: two shepherds looking up at one large star. The words Follow the star. Spell Follow, the, and star correctly.',
    'Panel 3, bottom left: Mary and Joseph beside a manger with baby Jesus and one sheep. The words A baby is born.',
    'Panel 4, bottom right: the angel and the two shepherds standing by the manger. The words Come and see.',
    'Every caption is large, simple, and correct English. Do not invent spellings. Do not add any other words, letters, numbers, or logos.',
    'Thick even outlines, closed shapes, no shading, no gray, no color, no hatching, no watermark.',
  ].join(' '),
  heavenAndNature: [
    'A finished coloring-book page for children ages 5 to 6, portrait, pure white background, solid black outlines only.',
    'At the top, large bubble outline letters that read exactly: LET HEAVEN AND NATURE SING.',
    'The word NATURE must be spelled N-A-T-U-R-E. The word SING must be spelled S-I-N-G. Do not drop any letter. Do not write ATURE.',
    'Below the words: two angels, one playing a horn and one holding an open songbook, two smiling children in winter coats, one sheep, two birds, one squirrel, a few pine trees, stars, and music notes.',
    'Thick even outlines a child can color. No shading, no gray, no color, no hatching, no watermark, no extra words.',
  ].join(' '),
};

async function main() {
  loadEnv();
  const site = readSite();
  void site;
  const separate = await findDir(christianRoot, 'Christian Christmas 29.png');
  const older = await findDir(christianRoot, 'Christian Christmas 06.png');
  const cozyDir = await findCozy();
  const crops = await splitStrip(path.join(separate, 'Christian Christmas 29.png'));
  const jpg = (folder: string, n: string) => path.join(folder, `Coloring page (${n}).JPG`);
  const svg = (folder: string, n: string) => path.join(folder, `Christian Christmas ${n}.svg`);
  const png = (folder: string, n: string) => path.join(folder, `Christian Christmas ${n}.png`);
  const verse = (n: string) => path.join(christianRoot, `Coloting Page ${n}.png`);
  const cozy = (n: string) => path.join(cozyDir, `(13)Cozy Christmas Coloring Pages-${n}.jpg`);
  const theme = 'christian-christmas-coloring-pages';
  const secular = 'christmas-coloring-pages';

  const christian: Sheet[] = [
    { theme, slug: 'huge-star', title: 'Huge Star Coloring Page', age: '2-3', description: 'One big star with short rays. For a child about 2 or 3.', alt: 'Line drawing of one huge star with short rays around it.', parentNote: 'The star is one big shape. The short rays can be the same color, or left white.', source: { kind: 'svg', file: svg(separate, '31') } },
    { theme, slug: 'huge-cross', title: 'Huge Cross Coloring Page', age: '2-3', description: 'One cross with a few holly leaves. For a child about 2 or 3.', alt: 'Line drawing of one large cross with holly leaves and berries.', parentNote: 'The cross is one big shape. The holly leaves are the only extra parts.', source: { kind: 'crop', index: 0 } },
    { theme, slug: 'pointed-star', title: 'Pointed Star Coloring Page', age: '2-3', description: 'One pointed star. For a child about 2 or 3.', alt: 'Line drawing of one large pointed star.', parentNote: 'Color the star one color. There is nothing else on the page.', source: { kind: 'crop', index: 1 } },
    { theme, slug: 'huge-candle', title: 'Huge Candle Coloring Page', age: '2-3', description: 'One candle in a holder. For a child about 2 or 3.', alt: 'Line drawing of one large candle in a round holder.', parentNote: 'The candle and the holder can be two colors. The flame is a small third shape.', source: { kind: 'crop', index: 2 } },
    { theme, slug: 'huge-wreath', title: 'Huge Wreath Coloring Page', age: '2-3', description: 'One wreath with a bow. For a child about 2 or 3.', alt: 'Line drawing of one large wreath with a bow on top.', parentNote: 'The wreath can be one green. The bow is the other part.', source: { kind: 'crop', index: 3 } },

    { theme, slug: 'little-church', title: 'Little Church Coloring Page', age: '3-4', description: 'A small church with a cross on the steeple. Thick lines. For about ages 3 to 4.', alt: 'Line drawing of a simple church with a steeple, a cross, and three stars.', parentNote: 'The building is one big color. The door and the windows are the smaller parts.', source: { kind: 'svg', file: svg(separate, '33') } },
    { theme, slug: 'steeple-church', title: 'Steeple Church Coloring Page', age: '3-4', description: 'A church seen from the side, with a tall steeple. For about ages 3 to 4.', alt: 'Line drawing of a church from the side with a tall steeple and a cross.', parentNote: 'The walls can be one color. The steeple is the tall part above the roof.', source: { kind: 'svg', file: svg(separate, '34') } },
    { theme, slug: 'manger-animals', title: 'Manger Animals Coloring Page', age: '3-4', description: 'Sheep, a donkey, a cow, and a camel around a manger. Thick lines. For about ages 3 to 4.', alt: 'Line drawing of farm animals gathered around a manger.', parentNote: 'Each animal can be its own color. The manger is the small shape in the middle.', source: { kind: 'raster', file: png(older, '06') } },
    { theme, slug: 'praying-angels', title: 'Praying Angels Coloring Page', age: '3-4', description: 'Two angels with their hands together. Thick lines. For about ages 3 to 4.', alt: 'Line drawing of two angels praying among clouds.', parentNote: 'Each angel is one big shape. The wings and the halos are the extra parts.', source: { kind: 'raster', file: jpg(christianRoot, '12') } },

    { theme, slug: 'poinsettia', title: 'Poinsettia Coloring Page', age: '4-5', description: 'One large poinsettia. For about ages 4 to 5.', alt: 'Line drawing of one poinsettia with leaves and a small center.', parentNote: 'The big petals can all be the same red. The center is a second color.', source: { kind: 'svg', file: svg(separate, '30') } },
    { theme, slug: 'peace-dove', title: 'Peace Dove Coloring Page', age: '4-5', description: 'A dove carrying an olive branch. For about ages 4 to 5.', alt: 'Line drawing of a dove in flight with an olive branch and two small stars.', parentNote: 'The dove is the big shape. The branch and the two stars are the small parts.', source: { kind: 'svg', file: svg(separate, '32') } },
    { theme, slug: 'joseph-and-baby', title: 'Joseph and Baby Coloring Page', age: '4-5', description: 'Joseph with a staff, standing by the baby in a manger. For about ages 4 to 5.', alt: 'Line drawing of Joseph with a staff beside baby Jesus in a manger.', parentNote: 'Joseph’s robe is one large area. The baby and the manger are the smaller parts.', source: { kind: 'svg', file: svg(older, '11') } },
    { theme, slug: 'baby-in-manger', title: 'Baby in a Manger Coloring Page', age: '4-5', description: 'Baby Jesus in a manger, with a halo. For about ages 4 to 5.', alt: 'Line drawing of baby Jesus lying in a wooden manger with a halo.', parentNote: 'The baby can be one color. The straw and the wooden manger are the other parts.', source: { kind: 'svg', file: svg(older, '13') } },
    { theme, slug: 'gift-camels', title: 'Gift Camels Coloring Page', age: '4-5', description: 'Two camels carrying stacks of gifts. For about ages 4 to 5.', alt: 'Line drawing of two camels walking with gifts tied on their backs.', parentNote: 'Each camel can be one color. The gifts are the boxes on top.', source: { kind: 'svg', file: svg(older, '21') } },
    { theme, slug: 'trumpet-angels', title: 'Trumpet Angels Coloring Page', age: '4-5', description: 'Two angels playing horns, with stars around them. For about ages 4 to 5.', alt: 'Line drawing of two angels playing horns among stars and music notes.', parentNote: 'Each angel is one big area. The horns, stars, and notes are the smaller parts.', source: { kind: 'svg', file: svg(older, '22') } },
    { theme, slug: 'trumpet-angel', title: 'Trumpet Angel Coloring Page', age: '4-5', description: 'One angel playing a horn. For about ages 4 to 5.', alt: 'Line drawing of one angel in a long robe playing a horn.', parentNote: 'The robe is the large area. The wings and the horn are the extra parts.', source: { kind: 'svg', file: svg(older, '23') } },
    { theme, slug: 'stable-animals', title: 'Stable Animals Coloring Page', age: '4-5', description: 'A stable with sheep, a baby, and a thatched roof. For about ages 4 to 5.', alt: 'Line drawing of a nativity stable with sheep, a donkey, and baby Jesus.', parentNote: 'The animals are the easy parts. The roof has more lines, so save that for last.', source: { kind: 'raster', file: jpg(christianRoot, '1') } },
    { theme, slug: 'stable-nativity', title: 'Stable Nativity Coloring Page', age: '4-5', description: 'Mary, the baby, a sheep, and a donkey under a stable roof. For about ages 4 to 5.', alt: 'Line drawing of Mary, baby Jesus, a sheep, and a donkey in a stable.', parentNote: 'Each animal can be its own color. Mary’s robe is one large area.', source: { kind: 'raster', file: jpg(christianRoot, '2') } },
    { theme, slug: 'smiling-holy-family', title: 'Smiling Holy Family Coloring Page', age: '4-5', description: 'Mary, Joseph, and the baby, with a sheep and a little goat. For about ages 4 to 5.', alt: 'Line drawing of Mary, Joseph, and baby Jesus with a goat and a sheep.', parentNote: 'The three people are the main shapes. The star above them can stay yellow.', source: { kind: 'raster', file: jpg(christianRoot, '17') } },
    { theme, slug: 'sleeping-in-stable', title: 'Sleeping in the Stable Coloring Page', age: '4-5', description: 'The baby asleep in a manger under a stable roof. For about ages 4 to 5.', alt: 'Line drawing of baby Jesus sleeping in a manger inside a stable.', parentNote: 'The blanket is one area. The straw and the little stars take longer.', source: { kind: 'raster', file: jpg(christianRoot, '44') } },
    { theme, slug: 'joseph-lantern', title: 'Joseph with a Lantern Coloring Page', age: '4-5', description: 'Joseph holding a lantern inside a stable. For about ages 4 to 5.', alt: 'Line drawing of Joseph holding a lantern beside a basket in a stable.', parentNote: 'The robe is the large area. The lantern is the small part to color carefully.', source: { kind: 'raster', file: jpg(christianRoot, '51') } },
    { theme, slug: 'visitors-at-stable', title: 'Visitors at the Stable Coloring Page', age: '4-5', description: 'Three people at a stable door, one with a basket. For about ages 4 to 5.', alt: 'Line drawing of three robed figures at a stable, one kneeling with a basket.', parentNote: 'Each robe can be a different color. The basket of round fruit is the small part.', source: { kind: 'raster', file: jpg(older, '4') } },
    { theme, slug: 'star-over-houses', title: 'Star over Houses Coloring Page', age: '4-5', description: 'One large star shining over four little houses. For about ages 4 to 5.', alt: 'Line drawing of a large star above a row of houses.', parentNote: 'The star is the big part. Each house can be a different color.', source: { kind: 'raster', file: jpg(separate, '22') } },

    { theme, slug: 'holy-family', title: 'Holy Family Coloring Page', age: '5-6', description: 'Mary, Joseph, and the baby, with a lantern and a staff. For about ages 5 to 6.', alt: 'Line drawing of Mary holding baby Jesus while Joseph stands with a lantern.', parentNote: 'Color the two robes first. The lantern and the baby’s blanket are the small parts.', source: { kind: 'svg', file: svg(older, '10') } },
    { theme, slug: 'shepherd-and-lamb', title: 'Shepherd and Lamb Coloring Page', age: '5-6', description: 'A kneeling shepherd holding a lamb, next to a manger. For about ages 5 to 6.', alt: 'Line drawing of a shepherd holding a lamb beside a manger.', parentNote: 'The robe has several folds. The lamb and the manger are smaller.', source: { kind: 'svg', file: svg(older, '12') } },
    { theme, slug: 'praying-mary', title: 'Praying Mary Coloring Page', age: '5-6', description: 'Mary kneeling with her hands together. The robe has many folds. For about ages 5 to 6.', alt: 'Line drawing of Mary kneeling in prayer, with a long folded robe.', parentNote: 'The folds can stay one color, or each fold can be a slightly different shade.', source: { kind: 'svg', file: svg(older, '14') } },
    { theme, slug: 'children-with-gifts', title: 'Children with Gifts Coloring Page', age: '5-6', description: 'Children bringing flowers and fruit to the Holy Family. For about ages 5 to 6.', alt: 'Line drawing of children bringing gifts to Mary, Joseph, and baby Jesus.', parentNote: 'There are several people. Color one child at a time, then the family.', source: { kind: 'svg', file: svg(older, '16') } },
    { theme, slug: 'harp-angel', title: 'Harp Angel Coloring Page', age: '5-6', description: 'An angel sitting and playing a harp. For about ages 5 to 6.', alt: 'Line drawing of a seated angel playing a harp.', parentNote: 'The robe and the wings are the large areas. The harp strings are thin, so they can stay black.', source: { kind: 'svg', file: svg(older, '25') } },
    { theme, slug: 'seated-harp-angel', title: 'Seated Harp Angel Coloring Page', age: '5-6', description: 'Another angel with a harp, with more folds in the robe. For about ages 5 to 6.', alt: 'Line drawing of an angel seated with a harp and folded robes.', parentNote: 'Pick one color for the robe before you start the wings. The harp is the small part.', source: { kind: 'svg', file: svg(older, '24') } },
    { theme, slug: 'open-bible', title: 'Open Bible Coloring Page', age: '5-6', description: 'An open Bible, a cross, two doves, and a star. For about ages 5 to 6.', alt: 'Line drawing of an open Bible with a cross, two doves, holly, and pinecones.', parentNote: 'The open book is the large shape. The doves, the star, and the pinecones are the extras.', source: { kind: 'svg', file: svg(older, '26') } },
    { theme, slug: 'mary-and-baby', title: 'Mary and Baby Coloring Page', age: '5-6', description: 'Mary holding the baby, with a halo. For about ages 5 to 6.', alt: 'Line drawing of Mary seated and holding baby Jesus.', parentNote: 'Mary’s robe and hair take the longest. The baby is the smaller shape in her arms.', source: { kind: 'raster', file: jpg(older, '56') } },
    { theme, slug: 'road-to-bethlehem', title: 'Road to Bethlehem Coloring Page', age: '5-6', description: 'Mary on a donkey, with Joseph walking beside her. For about ages 5 to 6.', alt: 'Line drawing of Mary riding a donkey while Joseph walks past small houses.', parentNote: 'The houses in the back can be one color. Mary, Joseph, and the donkey are the main parts.', source: { kind: 'raster', file: jpg(older, '8') } },
    { theme, slug: 'angel-crowd', title: 'Angel Crowd Coloring Page', age: '5-6', description: 'Many angels gathered around a manger. For about ages 5 to 6.', alt: 'Line drawing of a crowd of angels above and around a manger in a stable.', parentNote: 'There are a lot of angels. Color the ones on the ground first, then the ones in the sky.', source: { kind: 'raster', file: jpg(christianRoot, '37') } },
    { theme, slug: 'shepherds-and-angel', title: 'Shepherds and Angel Coloring Page', age: '5-6', description: 'An angel above two shepherds and their sheep. For about ages 5 to 6.', alt: 'Line drawing of an angel appearing to two shepherds in a field of sheep.', parentNote: 'The angel is the top of the page. The sheep in the middle can all be the same color.', source: { kind: 'raster', file: jpg(christianRoot, '41') } },
    { theme, slug: 'nativity-gathering', title: 'Nativity Gathering Coloring Page', age: '5-6', description: 'Mary and four visitors gathered around the baby. For about ages 5 to 6.', alt: 'Line drawing of Mary and four robed visitors around baby Jesus in a manger.', parentNote: 'Five robes is a longer sitting. Do one person, then the next.', source: { kind: 'raster', file: jpg(older, '29') } },
    { theme, slug: 'peace-banners', title: 'Peace Banners Coloring Page', age: '5-6', description: 'Angels around a stable, with two banners that say Peace. For about ages 5 to 6.', alt: 'Line drawing of angels and two banners reading Peace above a small stable.', parentNote: 'The word on each banner can stay uncolored. The angels are the parts to fill in.', source: { kind: 'raster', file: jpg(christianRoot, '88') } },
    { theme, slug: 'four-angel-scenes', title: 'Four Angel Scenes Coloring Page', age: '5-6', description: 'Four little pictures of angels and a manger, on one sheet. For about ages 5 to 6.', alt: 'Line drawing of four panels showing angels and baby Jesus in a manger.', parentNote: 'This is four small pictures. Color one box, then move to the next.', source: { kind: 'raster', file: jpg(christianRoot, '93') } },
    { theme, slug: 'nativity-story', title: 'Nativity Story Coloring Page', age: '5-6', description: 'Four pictures: an angel, the road, the stable, and the star. For about ages 5 to 6.', alt: 'Line drawing of four panels telling the nativity story.', parentNote: 'Each box is its own little picture. The bottom two have more parts than the top two.', source: { kind: 'raster', file: jpg(christianRoot, '94') } },
    { theme, slug: 'journey-story', title: 'Journey Story Coloring Page', age: '5-6', description: 'Four pictures: an angel, a man on a donkey, the stable, and a star. For about ages 5 to 6.', alt: 'Line drawing of four panels with an angel, a donkey journey, a stable, and a star.', parentNote: 'The stable box has the most animals. Save that one for when the child is still willing to sit.', source: { kind: 'raster', file: jpg(christianRoot, '95') } },
    { theme, slug: 'angel-story', title: 'Angel Story Coloring Page', age: '5-6', description: 'Four pictures with short words: good news, the star, the baby, and come and see. For about ages 5 to 6.', alt: 'Line drawing of four panels about an angel, shepherds, and baby Jesus, with short captions.', parentNote: 'Read one box, then color it, before you go to the next box.', source: { kind: 'redraw', prompt: redrawPrompts.angelStory } },
    { theme, slug: 'lord-my-shepherd', title: 'Lord My Shepherd Coloring Page', age: '5-6', description: 'The words The Lord is my shepherd, with a shepherd and sheep. For about ages 5 to 6.', alt: 'Line drawing of a shepherd with sheep under the words The Lord is my shepherd.', parentNote: 'The letters can be colored too. The sheep are the easier shapes under the words.', source: { kind: 'raster', file: verse('02') } },
    { theme, slug: 'be-still', title: 'Be Still Coloring Page', age: '5-6', description: 'The words Be still and know, with a child fishing and an angel. For about ages 5 to 6.', alt: 'Line drawing of a child in a boat and an angel under the words Be still and know.', parentNote: 'The words are the top of the page. The boat and the ducks are the picture underneath.', source: { kind: 'raster', file: verse('03') } },
    { theme, slug: 'god-keeps-promises', title: 'God Keeps Promises Coloring Page', age: '5-6', description: 'The words God keeps his promises, with a boat, animals, and a rainbow. For about ages 5 to 6.', alt: 'Line drawing of a boat full of animals under a rainbow and the words God keeps his promises.', parentNote: 'This one is a Bible story, not the stable. The animals in the boat are the busy part.', source: { kind: 'raster', file: verse('08') } },
    { theme, slug: 'jesus-loves-me', title: 'Jesus Loves Me Coloring Page', age: '5-6', description: 'The words Jesus loves me, with children and animals. For about ages 5 to 6.', alt: 'Line drawing of Jesus with children, a sheep, a bunny, and a bear under the words Jesus loves me.', parentNote: 'The letters are large. The children and the animals are the picture below.', source: { kind: 'raster', file: verse('09') } },
    { theme, slug: 'joy-to-the-world', title: 'Joy to the World Coloring Page', age: '5-6', description: 'The words Joy to the world, with carolers, a deer, and birds. For about ages 5 to 6.', alt: 'Line drawing of three carolers, a deer, and birds under the words Joy to the world.', parentNote: 'The words take a while if you color every letter. The deer and the birds are quicker.', source: { kind: 'raster', file: verse('13') } },
    { theme, slug: 'peace-on-earth', title: 'Peace on Earth Coloring Page', age: '5-6', description: 'The words Peace on earth, with an angel, a globe, and five children. For about ages 5 to 6.', alt: 'Line drawing of children holding hands and an angel above a globe, with the words Peace on earth.', parentNote: 'Each child can wear a different color. The globe is the circle behind them.', source: { kind: 'raster', file: verse('14') } },
    { theme, slug: 'joy-carol', title: 'Joy Carol Coloring Page', age: '5-6', description: 'The words Joy to the world, with an angel and three children in the snow. For about ages 5 to 6.', alt: 'Line drawing of an angel with a horn and three children under the words Joy to the world.', parentNote: 'This is another Joy to the World picture, with fewer animals and more snowflakes.', source: { kind: 'raster', file: verse('16') } },
    { theme, slug: 'away-in-a-manger', title: 'Away in a Manger Coloring Page', age: '5-6', description: 'The words Away in a manger, with the Holy Family and animals. For about ages 5 to 6.', alt: 'Line drawing of the nativity under the words Away in a manger.', parentNote: 'The animals along the bottom are the easy finish after the people.', source: { kind: 'raster', file: verse('17') } },
    { theme, slug: 'silent-night', title: 'Silent Night Coloring Page', age: '5-6', description: 'The words Silent night, holy night, with shepherds and an angel. For about ages 5 to 6.', alt: 'Line drawing of two shepherds, sheep, and an angel under the words Silent night, holy night.', parentNote: 'The words are large. The two sheep in front are a good place to start.', source: { kind: 'raster', file: verse('18') } },
    { theme, slug: 'glory-to-god', title: 'Glory to God Coloring Page', age: '5-6', description: 'The words Glory to God in the highest, with angels and shepherds. For about ages 5 to 6.', alt: 'Line drawing of angels and shepherds under the words Glory to God in the highest.', parentNote: 'There are several angels. Color the words first if the child likes letters, or the sheep if not.', source: { kind: 'raster', file: verse('20') } },
    { theme, slug: 'reason-for-the-season', title: 'Reason for the Season Coloring Page', age: '5-6', description: 'The words Jesus is the reason for the season, with two children and a manger. For about ages 5 to 6.', alt: 'Line drawing of two children kneeling by baby Jesus under the words Jesus is the reason for the season.', parentNote: 'The letters are the busiest part. The manger and the gifts are simpler.', source: { kind: 'raster', file: verse('21') } },
    { theme, slug: 'follow-the-star', title: 'Follow the Star Coloring Page', age: '5-6', description: 'The words Follow the star, with two children, a lantern, and a lamb. For about ages 5 to 6.', alt: 'Line drawing of two children following a star, one holding a lantern and one holding a lamb.', parentNote: 'The star and the two children are the main parts. The little town is in the back.', source: { kind: 'raster', file: verse('22') } },
    { theme, slug: 'child-is-born', title: 'Child Is Born Coloring Page', age: '5-6', description: 'The words Unto us a child is born, with Mary, Joseph, and the baby. For about ages 5 to 6.', alt: 'Line drawing of Mary, Joseph, and baby Jesus under the words Unto us a child is born.', parentNote: 'The sentence across the top is one line of letters. The family is the picture under it.', source: { kind: 'raster', file: verse('23') } },
    { theme, slug: 'heaven-and-nature', title: 'Heaven and Nature Coloring Page', age: '5-6', description: 'The words Let heaven and nature sing, with angels, children, and a sheep. For about ages 5 to 6.', alt: 'Line drawing of angels and children under the words Let heaven and nature sing.', parentNote: 'The letters spell a line from Joy to the World. The sheep and the children are under the words.', source: { kind: 'redraw', prompt: redrawPrompts.heavenAndNature } },

    { theme, slug: 'family-portrait', title: 'Family Portrait Coloring Page', age: '6-8', description: 'A closer picture of Mary, Joseph, and the baby. More lines in the faces and robes. For about ages 6 to 8.', alt: 'Line drawing of Mary and Joseph holding baby Jesus, with a star above them.', parentNote: 'The faces and the folds take a longer sitting. This is not a quick page.', source: { kind: 'raster', file: jpg(older, '110') } },
    { theme, slug: 'baby-and-rays', title: 'Baby and Rays Coloring Page', age: '6-8', description: 'The baby in a manger under a star, with many rays. For about ages 6 to 8.', alt: 'Line drawing of baby Jesus in a manger beneath a star with many long rays.', parentNote: 'The rays and the straw are the slow part. The baby is the center.', source: { kind: 'raster', file: jpg(older, '75') } },
    { theme, slug: 'nativity-snow-globe', title: 'Nativity Snow Globe Coloring Page', age: '6-8', description: 'The Holy Family inside a snow globe. Smaller lines. For about ages 6 to 8.', alt: 'Line drawing of a snow globe containing Mary, Joseph, baby Jesus, and two lambs.', parentNote: 'The people inside the globe are small. This one suits a child who likes detail.', source: { kind: 'raster', file: jpg(separate, '98') } },
    { theme, slug: 'sleeping-baby', title: 'Sleeping Baby Coloring Page', age: '6-8', description: 'A baby asleep in a manger, with hearts above. Finer lines. For about ages 6 to 8.', alt: 'Line drawing of a sleeping baby in a straw-filled manger with hearts above.', parentNote: 'The straw and the hearts are repetitive. The baby’s face is the careful part.', source: { kind: 'raster', file: jpg(christianRoot, '100') } },
    { theme, slug: 'swaddled-baby', title: 'Swaddled Baby Coloring Page', age: '6-8', description: 'A swaddled baby asleep in a round manger, with hearts. For about ages 6 to 8.', alt: 'Line drawing of a swaddled baby sleeping in a manger with hearts above.', parentNote: 'This is a second sleeping-baby picture, with a rounder manger and more hearts.', source: { kind: 'raster', file: jpg(christianRoot, '101') } },
    { theme, slug: 'angel-above-stable', title: 'Angel above the Stable Coloring Page', age: '6-8', description: 'A large angel on a cloud, with a tiny stable below. For about ages 6 to 8.', alt: 'Line drawing of a large praying angel above a small nativity stable.', parentNote: 'The angel’s wings and robe are most of the page. The stable at the bottom is small.', source: { kind: 'raster', file: jpg(older, '66') } },
    { theme, slug: 'three-wise-men', title: 'Three Wise Men Coloring Page', age: '6-8', description: 'Three wise men holding gifts. More detail in the faces and cloth. For about ages 6 to 8.', alt: 'Line drawing of three wise men holding two gifts and a decorated jar.', parentNote: 'Each robe is a long area. The gifts and the jar have the small patterns.', source: { kind: 'raster', file: jpg(older, '78') } },
    { theme, slug: 'family-by-the-star', title: 'Family by the Star Coloring Page', age: '6-8', description: 'Mary and Joseph with the baby, under a large star. Finer faces. For about ages 6 to 8.', alt: 'Line drawing of Mary and Joseph leaning over baby Jesus beneath a large star.', parentNote: 'The star has many points. The faces and hands are the careful part.', source: { kind: 'raster', file: jpg(older, '113') } },
    { theme, slug: 'angel-by-manger', title: 'Angel by the Manger Coloring Page', age: '6-8', description: 'An angel kneeling on a cloud beside the baby. For about ages 6 to 8.', alt: 'Line drawing of a kneeling angel beside baby Jesus in a manger on a cloud.', parentNote: 'The wings and the cloud are large. The baby is the smaller shape.', source: { kind: 'raster', file: jpg(older, '118') } },
  ];

  const cozySheets: Sheet[] = [
    { theme: secular, slug: 'penguin-cocoa', title: 'Penguin Cocoa Coloring Page', age: '4-5', description: 'A penguin with cocoa and a little cake, next to a tree. For about ages 4 to 5.', alt: 'Line drawing of a penguin holding cocoa beside a cake and a Christmas tree.', parentNote: 'The penguin is the big shape. The cake and the tree are the extra parts.', source: { kind: 'raster', file: cozy('04') } },
    { theme: secular, slug: 'skating-penguin', title: 'Skating Penguin Coloring Page', age: '4-5', description: 'A penguin skating in front of three trees. For about ages 4 to 5.', alt: 'Line drawing of a penguin ice skating by three Christmas trees and a string of lights.', parentNote: 'The penguin can be one color. The three trees are the other parts.', source: { kind: 'raster', file: cozy('05') } },
    { theme: secular, slug: 'penguin-and-tree', title: 'Penguin and Tree Coloring Page', age: '4-5', description: 'A penguin in a Santa hat beside a decorated tree. For about ages 4 to 5.', alt: 'Line drawing of a penguin wearing a Santa hat next to a Christmas tree.', parentNote: 'The tree and the penguin are about the same size. The hat is the small part.', source: { kind: 'raster', file: cozy('07') } },
    { theme: secular, slug: 'bear-and-tree', title: 'Bear and Tree Coloring Page', age: '4-5', description: 'A bear holding a tiny tree, with a bigger tree beside it. For about ages 4 to 5.', alt: 'Line drawing of a bear holding a small Christmas tree next to a larger tree.', parentNote: 'The bear is one big shape. The little tree in its paws can be green.', source: { kind: 'raster', file: cozy('16') } },
    { theme: secular, slug: 'reindeer-cocoa', title: 'Reindeer Cocoa Coloring Page', age: '4-5', description: 'A reindeer with cocoa, sitting by a fireplace. For about ages 4 to 5.', alt: 'Line drawing of a reindeer holding cocoa beside a fireplace and a string of lights.', parentNote: 'The reindeer and the fireplace are the two big areas. The mug is small.', source: { kind: 'raster', file: cozy('26') } },
    { theme: secular, slug: 'fireplace-cats', title: 'Fireplace Cats Coloring Page', age: '4-5', description: 'Two cats on a rug in front of a fireplace. For about ages 4 to 5.', alt: 'Line drawing of two cats sitting by a fireplace with ornaments and lights.', parentNote: 'Each cat can be a different color. The fireplace is the shape behind them.', source: { kind: 'raster', file: cozy('48') } },
    { theme: secular, slug: 'cat-in-basket', title: 'Cat in a Basket Coloring Page', age: '4-5', description: 'A cat in a basket under a mantel with stockings. For about ages 4 to 5.', alt: 'Line drawing of a cat sitting in a basket in a fireplace, with stockings on the mantel.', parentNote: 'The basket and the cat are the middle. The stockings are the two shapes on the sides.', source: { kind: 'raster', file: cozy('60') } },
    { theme: secular, slug: 'cozy-candy-house', title: 'Candy House Coloring Page', age: '4-5', description: 'A gingerbread house with a candy cane chimney. For about ages 4 to 5.', alt: 'Line drawing of a smiling gingerbread house with a candy cane in the chimney.', parentNote: 'The house is one big shape. The candies and the snowflakes are the small parts.', source: { kind: 'raster', file: cozy('80') } },
    { theme: secular, slug: 'elf-and-gifts', title: 'Elf and Gifts Coloring Page', age: '4-5', description: 'An elf with cocoa and two wrapped gifts. For about ages 4 to 5.', alt: 'Line drawing of an elf holding cocoa between two Christmas gifts.', parentNote: 'The elf is the center. Each gift can be a different color.', source: { kind: 'raster', file: cozy('91') } },
    { theme: secular, slug: 'window-penguins', title: 'Window Penguins Coloring Page', age: '4-5', description: 'Two penguins in a window beside a Christmas tree. For about ages 4 to 5.', alt: 'Line drawing of two penguins looking out a window next to a Christmas tree.', parentNote: 'The tree and the window are the large parts. The penguins are in the middle.', source: { kind: 'raster', file: cozy('100') } },
  ];

  const failed: string[] = [];
  let christianOrder = 1;
  let cozyOrder = 18;
  for (const sheet of [...christian, ...cozySheets]) {
    const order = sheet.theme === secular ? cozyOrder++ : christianOrder++;
    try {
      let image: Buffer;
      if (sheet.source.kind === 'svg') image = await renderSvg(sheet.source.file);
      else if (sheet.source.kind === 'raster') image = await flatten(sheet.source.file);
      else if (sheet.source.kind === 'crop') image = crops[sheet.source.index];
      else {
        console.log(`redraw ${sheet.slug}...`);
        image = await sharp(await generateColoringPage(sheet.source.prompt)).flatten({ background: '#ffffff' }).png().toBuffer();
      }
      await publish(sheet, order, image);
    } catch (error) {
      failed.push(`${sheet.slug}: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`FAILED ${sheet.slug}`);
    }
  }
  if (failed.length) {
    console.error('FAILURES');
    for (const line of failed) console.error(line);
    process.exitCode = 1;
  } else {
    console.log(`done christian=${christian.length} cozy=${cozySheets.length}`);
  }
}

await main();
