import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const dir = 'D:/COLORING/остатки сэнксгивинг и зима/сэнксгивинг';
const out = 'D:/KIDS/factory/out/thanksgiving-preview';
fs.mkdirSync(out, { recursive: true });

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.png'))
  .sort((a, b) => {
    const na = Number(a.match(/-(\d+)\.png$/)?.[1] || 0);
    const nb = Number(b.match(/-(\d+)\.png$/)?.[1] || 0);
    return na - nb;
  });

console.log('total', files.length);
const picks = files.filter((_, i) => i % 4 === 0);
for (const f of picks) {
  await sharp(path.join(dir, f)).resize({ width: 480 }).png().toFile(path.join(out, f));
}
console.log('previews', picks.length);
for (const f of picks) console.log(f);
