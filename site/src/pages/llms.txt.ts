import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { absoluteUrl, site } from '../site';
import { ageBandLabel, ageBands } from '../lib/ages';
import { difficultyLabel } from '../lib/difficulty';
import { sheetPath, themePath } from '../lib/paths';

export const GET: APIRoute = async () => {
  const themes = await getCollection('themes');
  const sheets = await getCollection('sheets');
  const bandOrder = ageBands.map((band) => band.id);
  const byAgeThenOrder = (a: (typeof themes)[number], b: (typeof themes)[number]) => {
    const age = bandOrder.indexOf(a.data.ageBand) - bandOrder.indexOf(b.data.ageBand);
    if (age !== 0) return age;
    return a.data.order - b.data.order;
  };
  const everyday = themes.filter((theme) => theme.data.kind !== 'seasonal').sort(byAgeThenOrder);
  const holidays = themes.filter((theme) => theme.data.kind === 'seasonal').sort((a, b) => a.data.order - b.data.order);

  function sheetLines(themeId: string) {
    return sheets
      .filter((sheet) => sheet.data.theme === themeId)
      .sort((a, b) => a.data.order - b.data.order)
      .map(
        (sheet) =>
          `  - [${sheet.data.title}](${absoluteUrl(sheetPath(themeId, sheet.data.slug))}) — ${ageBandLabel(sheet.data.age)}, ${difficultyLabel(sheet.data.difficulty).toLowerCase()}`,
      );
  }

  function collectionBlock(theme: (typeof themes)[number]) {
    return [
      `- [${theme.data.title}](${absoluteUrl(themePath(theme.id))}): ${theme.data.description}`,
      ...sheetLines(theme.id),
    ];
  }

  const lines = [
    `# ${site.name}`,
    `> Original line drawings for parents in the United States, free to print at home. ${site.description}`,
    '',
    'Individual sheet URLs live under each collection, at /{collection}/{sheet}/. This file is generated from the theme and sheet collections when the site is built.',
    '',
    '## Age bands',
    ...ageBands.map((band) => `- ${band.label}: ${band.blurb}`),
    '',
    '## Collections',
    ...everyday.flatMap(collectionBlock),
    '',
    '## Holidays',
    ...holidays.flatMap(collectionBlock),
    '',
    '## Printing',
    `- [How to print](${absoluteUrl('/how-to-print/')}): US Letter and A4 PDFs, scale, and supplies.`,
    `- [About](${absoluteUrl('/about/')}): Julia, a mom of two, makes the drawings on this site.`,
    `- Contact: ${site.email}`,
    '',
    'Drawings are original to this site. They are free for personal and classroom printing and are not for resale. The pages do not use trademarked characters.',
    '',
  ];
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
