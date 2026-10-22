import fs from 'node:fs';
import path from 'node:path';
import { auditKdpFolder } from '../src/kdp-audit.ts';
import { loadEnv } from '../src/env.ts';
import { fitOnLetter } from '../src/import-stock.ts';
import sharp from 'sharp';

loadEnv();

/**
 * Second-pass redraw: even line weight, no square frame, native US Letter (8.5×11).
 * Source folder stays stock; output goes to thanksgiving-feast-book.
 */
const folder = 'D:/KIDS/factory/out/kdp/thanksgiving-feast-source';
const bookDir = 'D:/KIDS/factory/out/kdp/thanksgiving-feast-book';
const files = fs
  .readdirSync(folder)
  .filter((f) => f.endsWith('.png'))
  .sort();
const select = files.map((_, i) => String(i + 1)).join(',');

const styleHint = [
  'Bold-and-easy kids coloring book page for US Letter portrait (taller than wide).',
  'Compose for a tall 8.5 by 11 inch page: subject centered with comfortable white margin, NOT a square crop, NOT a picture framed inside a square border.',
  'ONE even line weight only — same thick black outline everywhere. No thin inner lines, no hairline details, no wood grain, no crosshatching, no variable stroke.',
  'Pure white background. Solid black outlines only. Closed shapes a child can color with a crayon.',
  'Cozy Thanksgiving feast / harvest food: pies, table, cornucopia, pumpkins, baskets, mashed potatoes, roasted turkey platter as FOOD only.',
  'If people appear: very simple round cartoon heads, tiny dot eyes, simple smile curve, NO anime eyes, NO eye highlights, NO eyelashes, same line weight as the food.',
  'No pilgrims, no Native American costumes, no living turkey characters, no animals cooking, no text, no logos, no page border, no decorative frame.',
].join(' ');

console.log(`Redrawing ${files.length} Thanksgiving pages (US Letter, even lines)...`);
const report = await auditKdpFolder({
  folder,
  redraw: true,
  overwrite: true,
  age: '4-6',
  styleHint,
  select,
});

console.log('Audit out:', report.outDir);

// Refit each redraw onto true 2550×3300 letter and refresh the book folder.
fs.rmSync(bookDir, { recursive: true, force: true });
fs.mkdirSync(bookDir, { recursive: true });

const redraws = fs
  .readdirSync(report.outDir)
  .filter((f) => /^\d{2}-.+\.png$/i.test(f))
  .sort();

for (const name of redraws) {
  const raw = await fs.promises.readFile(path.join(report.outDir, name));
  const letter = await fitOnLetter(raw);
  // Drop any leftover near-black frame by slight trim then letter again if needed.
  const cleaned = await sharp(letter)
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer();
  const final = await fitOnLetter(cleaned);
  await fs.promises.writeFile(path.join(bookDir, name), final);
  const m = await sharp(final).metadata();
  console.log('book', name, `${m.width}x${m.height}`);
}

fs.writeFileSync(
  path.join(bookDir, 'README.txt'),
  [
    'Cozy Thanksgiving Feast — redrawn pages',
    'Format: US Letter 2550×3300 (8.5×11 @ 300dpi)',
    'Style: even bold outline, no square stock frames',
    `Source audit: ${report.outDir}`,
    `Pages: ${redraws.length}`,
    '',
    'Do NOT use thanksgiving-feast-source for the book — that folder is square stock.',
  ].join('\n'),
);

console.log('BOOK DIR', bookDir, 'pages', redraws.length);
