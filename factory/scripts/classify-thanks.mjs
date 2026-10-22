import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { loadEnv } from '../src/env.ts';
import { visionChat } from '../src/openrouter.ts';

loadEnv();

const dirs = [
  'D:/COLORING/остатки сэнксгивинг и зима/сэнксгивинг',
  'D:/COLORING/остатки сэнксгивинг и зима/other',
];

const files = dirs.flatMap((dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .map((f) => path.join(dir, f)),
);

const system = `You classify kids Thanksgiving coloring-page line art for a commercial book.
Return ONLY compact JSON (one object):
{"file":"basename","bucket":"...","subject":"short english","ok":true|false,"why":"short"}
bucket must be one of:
- feast_food (pies, table, cornucopia, rolls, mashed potatoes, cooked turkey platter — food only, no living turkey)
- live_turkey (friendly living turkey character)
- harvest (pumpkins, corn, leaves, wreath, baskets of produce — no feast table)
- animal_cute (animals with harvest props, no cooking animals)
- pilgrim_history (pilgrims, Native Americans, historical costumes, Mayflower)
- weird (animals cooking meat, surreal mashups, scary, off-brand)
- text_heavy (big banners/words as main subject)
- other
ok=true only if suitable for a cozy kids book that is NOT free on a website already, sellable, and not historically sensitive. Prefer feast_food and harvest. Mark pilgrim_history and weird as ok=false. live_turkey ok only if cute and simple.`;

const out = [];
const outFile = 'D:/KIDS/factory/out/thanksgiving-classify.jsonl';
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, '');

for (const [i, file] of files.entries()) {
  const base = path.basename(file);
  process.stdout.write(`[${i + 1}/${files.length}] ${base}... `);
  try {
    const thumb = await sharp(file).resize({ width: 768 }).png().toBuffer();
    const text = await visionChat(system, `Classify this image. file=${base}`, thumb);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const row = jsonMatch ? JSON.parse(jsonMatch[0]) : { file: base, bucket: 'other', ok: false, why: text.slice(0, 120) };
    row.file = base;
    row.path = file;
    out.push(row);
    fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
    console.log(row.bucket, row.ok ? 'OK' : 'no', '-', row.subject || row.why);
  } catch (e) {
    const row = { file: base, path: file, bucket: 'other', ok: false, why: String(e.message || e) };
    out.push(row);
    fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
    console.log('ERR', row.why);
  }
}

const summary = {};
for (const row of out) {
  const k = `${row.bucket}|${row.ok ? 'ok' : 'skip'}`;
  summary[k] = (summary[k] || 0) + 1;
}
fs.writeFileSync(
  'D:/KIDS/factory/out/thanksgiving-classify-summary.json',
  JSON.stringify({ total: out.length, summary, keep: out.filter((r) => r.ok) }, null, 2),
);
console.log('DONE', summary);
