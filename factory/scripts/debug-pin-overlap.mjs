import fs from 'node:fs';
import path from 'node:path';

const pinRoot = 'D:/KIDS/site/public/pins';

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(png|jpg|jpeg|webp)$/i.test(name)) acc.push(p);
  }
  return acc;
}

const all = walk(pinRoot);
const done = new Set();
const root = new Set();
for (const abs of all) {
  const rel = path.relative(pinRoot, abs).split(path.sep).join('/');
  const b = path.basename(abs).toLowerCase();
  if (rel.startsWith('done/') || rel.split('/')[0] === 'done') done.add(b);
  else if (!rel.includes('/')) root.add(b);
}

const check = [
  'thanksgiving-coloring-pages-friendly-turkey.png',
  'winter-coloring-pages-hot-cocoa-cookies.png',
  'christmas-coloring-pages-snowman.png',
];
for (const c of check) {
  console.log(c, { inRoot: root.has(c), inDone: done.has(c) });
}

for (const t of ['thanksgiving', 'winter', 'christmas']) {
  const r = [...root].filter((x) => x.startsWith(`${t}-`));
  const overlap = r.filter((x) => done.has(x));
  console.log(t, { root: r.length, overlap: overlap.length, overlapSample: overlap.slice(0, 8) });
}
console.log('done size', done.size);
