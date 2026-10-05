import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { absoluteUrl, site } from '../site';
import { themePath } from '../lib/paths';

export const GET: APIRoute = async () => {
  const themes = (await getCollection('themes')).sort((a, b) => {
    if (a.data.kind !== b.data.kind) return a.data.kind === 'evergreen' ? -1 : 1;
    return a.data.order - b.data.order;
  });
  const lines = [
    `# ${site.name}`,
    `> ${site.description}`,
    '',
    'This site is a parent-facing library of free printable coloring pages. Each theme is a collection page. Individual drawings live under that collection and link back to it.',
    '',
    '## Collections',
    ...themes.map((theme) => `- [${theme.data.title}](${absoluteUrl(themePath(theme.id))}): ${theme.data.description}`),
    '',
    '## Printing',
    `- [How to print](${absoluteUrl('/how-to-print/')}): US Letter and A4 PDFs, scale, and supplies.`,
    '',
    'Drawings are original to this site. They are free for personal and classroom printing and are not for resale. The pages do not use trademarked characters.',
    '',
  ];
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
