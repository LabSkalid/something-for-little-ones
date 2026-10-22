import fs from 'node:fs';
import path from 'node:path';

const dir = 'D:/KIDS/factory/out/kdp/thanksgiving-feast-source';
const manifestPath = path.join(dir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

for (const page of manifest.pages) {
  const oldPath = path.join(dir, page.dest);
  // Avoid ^\d{2,}- which kdp-audit treats as stray redraw overrides.
  const nextName = page.dest.replace(/^(\d{2})-/, 'p$1-');
  const nextPath = path.join(dir, nextName);
  if (oldPath !== nextPath && fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, nextPath);
    console.log(page.dest, '→', nextName);
    page.dest = nextName;
  }
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log('renamed', manifest.pages.length);
