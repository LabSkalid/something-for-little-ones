import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { buildPins } from '../src/build-assets.ts';
import { sheetContentRoot } from '../src/paths.ts';

const theme = 'animal-coloring-pages';
const dir = path.join(sheetContentRoot, theme);
const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.md'));
const slugs: string[] = [];
for (const file of files) {
  const raw = await fs.readFile(path.join(dir, file), 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const data = parse(match?.[1] ?? '') as { slug?: string; order?: number };
  const order = Number(data.order ?? 0);
  if (order >= 69) continue;
  slugs.push(String(data.slug ?? file.replace(/\.md$/, '')));
}
console.log(`sheets not in the two new bundles: ${slugs.length}`);
await buildPins({
  theme,
  mode: 'collection',
  slugs,
  removeOld: false,
  writeCopy: false,
});
