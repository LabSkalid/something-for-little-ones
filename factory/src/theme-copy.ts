/** Parent-facing collection copy from the sheets that are actually on the site.
 * Never invent animals, objects, scenes, or contents that are not in the titles.
 */

function englishList(items: string[]) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function cleanTitle(title: string) {
  return title.replace(/\s+coloring pages?\s*$/i, '').trim();
}

export function exampleNames(
  sheets: { title: string; age?: string }[],
  limit = 4,
): string[] {
  const order = ['2-3', '3-4', '4-5', '5-6', '6-8'];
  const used = new Set<string>();
  const out: string[] = [];
  const take = (title: string) => {
    const name = cleanTitle(title);
    const key = name.toLowerCase();
    if (!name || used.has(key) || out.length >= limit) return;
    used.add(key);
    out.push(name);
  };
  for (const age of order) {
    const hit = sheets.find((sheet) => sheet.age === age);
    if (hit) take(hit.title);
  }
  for (const sheet of sheets) take(sheet.title);
  return out;
}

export function listEnglish(items: string[]) {
  return englishList(items);
}

export function buildThemeBody(
  _collectionTitle: string,
  _sheetTitles: string[],
  extra?: { ageSpan?: string; multiAge?: boolean },
): string {
  const lines = [
    'Each page above opens to a print-ready file. Use the Letter PDF or the A4 PDF—same drawing, not a screenshot of this page.',
  ];
  if (extra?.ageSpan && extra.multiAge) {
    lines.unshift(
      `Pages are sorted by age (${extra.ageSpan}). Match the lines to your child, not only the birthday.`,
    );
  } else if (extra?.ageSpan) {
    lines.unshift(`These pages are drawn for ${extra.ageSpan}.`);
  }
  return lines.join('\n\n');
}
