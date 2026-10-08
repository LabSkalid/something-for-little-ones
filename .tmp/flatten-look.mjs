import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire('D:/KIDS/factory/package.json');
const sharp = require('sharp');
const root = 'D:/COLORING/Christian Christmass';
const out = 'D:/KIDS/.tmp/stock-look';
fs.mkdirSync(out, { recursive: true });
const files = [
  'отдельно/Christian Christmas 32.png',
  'старше/Christian Christmas 11.png',
  'старше/Christian Christmas 13.png',
  'старше/Christian Christmas 21.png',
  'старше/Christian Christmas 23.png',
  'старше/Christian Christmas 24.png',
  'старше/Christian Christmas 26.png',
];
for (const rel of files) {
  const buf = await sharp(path.join(root, rel))
    .flatten({ background: '#ffffff' })
    .resize({ width: 720, withoutEnlargement: true })
    .png()
    .toBuffer();
  const dest = path.join(out, `${path.basename(rel, '.png')}.png`);
  fs.writeFileSync(dest, buf);
  console.log(dest);
}
