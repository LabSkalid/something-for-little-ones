import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function contentRoot() {
  const fromModule = fileURLToPath(new URL('../content', import.meta.url));
  if (fs.existsSync(fromModule)) return fromModule;
  return path.join(process.cwd(), 'src/content');
}

function frontmatter(file: string) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const data: Record<string, string> = {};
  if (!match) return data;
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.+)$/);
    if (!kv) continue;
    data[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return data;
}

function day(value: string | undefined) {
  return value?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
}

/** Pathname → YYYY-MM-DD, read from theme and sheet frontmatter. No URL list. */
export function contentLastmods() {
  const map = new Map<string, string>();
  const root = contentRoot();
  const themesDir = path.join(root, 'themes');
  for (const file of fs.readdirSync(themesDir)) {
    if (!file.endsWith('.md')) continue;
    const data = frontmatter(path.join(themesDir, file));
    const lastmod = day(data.updatedDate) ?? day(data.pubDate);
    if (lastmod) map.set(`/${file.slice(0, -3)}/`, lastmod);
  }
  const sheetsDir = path.join(root, 'sheets');
  for (const entry of fs.readdirSync(sheetsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(sheetsDir, entry.name);
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const data = frontmatter(path.join(dir, file));
      const lastmod = day(data.updatedDate) ?? day(data.pubDate);
      if (!lastmod) continue;
      const theme = data.theme ?? entry.name;
      const slug = data.slug ?? file.slice(0, -3);
      map.set(`/${theme}/${slug}/`, lastmod);
    }
  }
  return map;
}
