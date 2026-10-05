import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from './paths.ts';

export function readSite() {
  const raw = fs.readFileSync(path.join(siteRoot, 'src', 'site.ts'), 'utf8');
  const name = raw.match(/name:\s*'([^']+)'/)?.[1] ?? 'Something for Little Ones';
  const url = raw.match(/url:\s*'([^']+)'/)?.[1] ?? 'https://somethingforlittleones.com';
  const host = new URL(url).host.replace(/^www\./, '');
  return { name, url, host };
}
