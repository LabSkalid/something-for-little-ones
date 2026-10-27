import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { factoryRoot, themeContentRoot } from './paths.ts';
import { listThemeSheets } from './import-stock.ts';
import { buildThemeBody } from './theme-copy.ts';

const apply = process.argv.includes('--apply');
const files = (await fs.readdir(themeContentRoot)).filter((name) => name.endsWith('.md')).sort();
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = path.join(factoryRoot, 'out', `theme-body-backups-${timestamp}`);



const changes: { file: string; original: string; next: string; body: string }[] = [];
for (const name of files) {
  const file = path.join(themeContentRoot, name);
  const original = await fs.readFile(file, 'utf8');
  const match = original.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    console.warn(`SKIP ${name}: frontmatter not found`);
    continue;
  }
  const meta = parse(match[1]) as Record<string, unknown>;
  const title = String(meta.title ?? name.replace(/\.md$/, '').replaceAll('-', ' '));
  const sheets = await listThemeSheets(name.replace(/\.md$/, ''));
  const body = buildThemeBody(title, sheets.map((sheet) => sheet.title));
  const next = `---\n${match[1]}\n---\n\n${body}\n`;
  changes.push({ file, original, next, body });
}

console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${changes.length} collection files found.`);
for (const item of changes) {
  console.log(`\n${path.basename(item.file)}\n  ${item.body.replaceAll('\n', ' ')}`);
}
if (!apply) {
  console.log('\nNo files changed. Review the output, then run with --apply to back up originals and update the Markdown bodies.');
  process.exit(0);
}
await fs.mkdir(backupRoot, { recursive: true });
for (const item of changes) {
  await fs.copyFile(item.file, path.join(backupRoot, path.basename(item.file)));
}
for (const item of changes) {
  await fs.writeFile(item.file, item.next, 'utf8');
}
console.log(`\nUpdated ${changes.length} collection bodies. Original files backed up to: ${backupRoot}`);
