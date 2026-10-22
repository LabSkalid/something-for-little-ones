/**
 * Build a sellable Thanksgiving book source folder:
 * feast food + harvest only. No live-turkey friends, no pilgrims,
 * no animal mashups, no text-cover noise.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const rows = fs
  .readFileSync('D:/KIDS/factory/out/thanksgiving-classify.jsonl', 'utf8')
  .trim()
  .split(/\n/)
  .map((l) => JSON.parse(l));

/** Hard skips by basename number / subject keywords */
const dropFiles = new Set([
  // pilgrim-hat props
  'Bold and Easy Cozy Thanksgiving-125.png',
  'Bold and Easy Cozy Thanksgiving-83.png',
  // carving / intense cooked-animal focus
  'Bold and Easy Cozy Thanksgiving-109.png',
  'Bold and Easy Cozy Thanksgiving-90.png', // turkey in oven
  // near-dupes of dinner tables — keep a few only (dropped below by subject)
]);

const dropSubjectRe =
  /pilgrim|native|mayflower|carving|cutting board|wine|checkers|tv|gnome|knitting|hot chocolate/i;

/** Prefer one of each subject family */
const subjectBuckets = [
  { id: 'feast-spread', re: /feast with turkey and pies|feast with turkey and pumpkin/i, max: 1 },
  { id: 'dinner-table', re: /dinner table|table setting|family dinner|family thanksgiving/i, max: 3 },
  { id: 'platter-plate', re: /platter|dinner plate|plate of food|roasted turkey and pie/i, max: 2 },
  { id: 'pie-dessert', re: /pie|cupcake|cookies|baking/i, max: 3 },
  { id: 'cornucopia', re: /cornucopia/i, max: 3 },
  { id: 'basket', re: /basket/i, max: 2 },
  { id: 'pumpkins-room', re: /cozy|pumpkins in|living room|room with pumpkins/i, max: 3 },
  { id: 'centerpiece-candles', re: /centerpiece|candles|scarecrow/i, max: 3 },
  { id: 'mashed', re: /mashed/i, max: 1 },
  { id: 'harvest-people', re: /harvesting/i, max: 2 },
];

const pool = rows.filter((r) => {
  if (!r.ok) return false;
  if (r.bucket !== 'feast_food' && r.bucket !== 'harvest') return false;
  if (dropFiles.has(r.file)) return false;
  if (dropSubjectRe.test(`${r.subject} ${r.why || ''}`)) return false;
  return true;
});

const picked = [];
const used = new Set();
for (const bucket of subjectBuckets) {
  let n = 0;
  for (const r of pool) {
    if (used.has(r.file)) continue;
    if (!bucket.re.test(r.subject || '')) continue;
    picked.push({ ...r, pickBucket: bucket.id });
    used.add(r.file);
    n += 1;
    if (n >= bucket.max) break;
  }
}

// Fill leftovers that didn't match a bucket but are still feast/harvest
for (const r of pool) {
  if (used.has(r.file)) continue;
  if (picked.length >= 36) break;
  picked.push({ ...r, pickBucket: 'extra' });
  used.add(r.file);
}

picked.sort((a, b) => {
  const na = Number(a.file.match(/-(\d+)\.png$/)?.[1] || 0);
  const nb = Number(b.file.match(/-(\d+)\.png$/)?.[1] || 0);
  return na - nb;
});

const outDir = 'D:/KIDS/factory/out/kdp/thanksgiving-feast-source';
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const manifest = [];
let i = 0;
for (const r of picked) {
  i += 1;
  const num = String(i).padStart(2, '0');
  const slug = (r.subject || 'page')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const destName = `${num}-${slug || 'page'}.png`;
  const dest = path.join(outDir, destName);
  // Stock is black lines on transparent — flatten to white for coloring / KDP.
  await sharp(r.path)
    .flatten({ background: '#ffffff' })
    .png()
    .toFile(dest);
  manifest.push({
    index: i,
    dest: destName,
    source: r.file,
    bucket: r.bucket,
    pickBucket: r.pickBucket,
    subject: r.subject,
  });
  console.log(destName, '←', r.file, '|', r.subject);
}

fs.writeFileSync(
  path.join(outDir, 'manifest.json'),
  JSON.stringify({ concept: 'Cozy Thanksgiving Feast', count: manifest.length, pages: manifest }, null, 2),
);
console.log('WROTE', outDir, 'pages=', manifest.length);
