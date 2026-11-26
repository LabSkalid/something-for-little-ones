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

const FOOTER =
  'Each page above opens to a print-ready file. Use the Letter PDF or the A4 PDF. Same drawing, not a screenshot of this page.';

/** Lede + meta for scene hubs when import would leave a sheet-title catalog dump. */
export const HUB_THEME_LEDE: Record<string, { tagline: string; description: string }> = {
  'woodland-animal-coloring-pages': {
    tagline:
      'Forest animals in simple woods scenes, fuller pictures with trees, mushrooms, and patterns for about ages 6 to 8.',
    description:
      'Woodland animal coloring pages for ages 6 to 8. Forest scenes with fox, deer, owl, and more, not the huge single-animal pages for toddlers.',
  },
  'farm-animal-coloring-pages': {
    tagline: 'Farmyard scenes with several animals, a cottage, and a pond, busier lines for about ages 6 to 8.',
    description: 'Farm animal coloring pages for ages 6 to 8. Barn and pond scenes, not one huge animal on white.',
  },
  'town-scene-coloring-pages': {
    tagline:
      'Town and village scenes with patterns and extra detail, for a longer coloring sit, about ages 6 to 8.',
    description:
      'Town and village coloring pages for ages 6 to 8. Bakery windows, trains, parks, and street scenes with many areas to color.',
  },
  'ocean-scene-coloring-pages': {
    tagline: 'Coral reef, seahorses, tide pool, submarine, and more patterns, for about ages 5 to 6.',
    description:
      'Ocean scene coloring pages for about ages 5 to 6. Reefs, boats, and patterned sea life, not single dolphins on white for toddlers.',
  },
  'first-animal-coloring-pages': {
    tagline: 'One huge animal per page, extra-thick lines for about ages 2 to 3.',
    description: 'First animal coloring pages for ages 2 to 3. One huge animal per page with extra-thick outlines for toddlers.',
  },
  'dinosaur-scene-coloring-pages': {
    tagline: 'Dinosaurs with spots, patterns, and small scenes, for about ages 5 to 6, busier than the toddler dino set.',
    description:
      'Dinosaur scene coloring pages for ages 5 to 6. Patterns and outdoor scenes, not the five huge dinos for ages 3–4.',
  },
};

export function ledeLooksLikeCatalog(tagline: string, description: string): boolean {
  const t = tagline.trim();
  const d = description.trim();
  if (/^This collection features\b/i.test(d)) return true;
  if (/Pick a page and print the PDF/i.test(d)) return true;
  if (/\bGrouped by age\b/i.test(t) || /\bGrouped by age\b/i.test(d)) return true;
  if (/coloring pages, with designs such as/i.test(d)) return true;
  if (/^Printable .+ for about ages .+\. Thick outlines, ready to download/i.test(t)) return false;
  const commaList = /^[^.]+\. For about ages /i.test(t);
  const titleSalad = (t.match(/\b[A-Z][a-z]+(?: [A-Z][a-z]+)*\b/g) ?? []).length >= 3;
  return commaList || (titleSalad && /Woodland |Farm |Town |Ocean |Dinosaur /i.test(t));
}

/** Body copy for scene hubs (import must not replace with a title dump). */
export const HUB_THEME_BODIES: Record<string, string> = {
  'woodland-animal-coloring-pages': [
    'These pages are drawn for about ages 6 to 8. Each one is a small forest scene, not one huge animal on white.',
    'For a single cute animal on thick lines, try [Animal Coloring Pages](/animal-coloring-pages/) or [First Animal Coloring Pages](/first-animal-coloring-pages/). For barn and pond scenes, try [Farm Animal Coloring Pages](/farm-animal-coloring-pages/).',
    FOOTER,
  ].join('\n\n'),
  'farm-animal-coloring-pages': [
    'These pages are drawn for about ages 6 to 8. Barnyard scenes with several animals, not one huge shape on white.',
    'For a single animal on thick lines, try [Animal Coloring Pages](/animal-coloring-pages/) or [First Animal Coloring Pages](/first-animal-coloring-pages/). For forest scenes, see [Woodland Animal Coloring Pages](/woodland-animal-coloring-pages/).',
    FOOTER,
  ].join('\n\n'),
  'town-scene-coloring-pages': [
    'For simpler vehicles and one big object per page, try [Simple Vehicle Coloring Pages](/simple-vehicle-coloring-pages/) (ages 4–5) or [Car Coloring Pages](/car-coloring-pages/) (ages 3–4).',
    FOOTER,
  ].join('\n\n'),
  'ocean-scene-coloring-pages': [
    'For one friendly whale or dolphin on white, use [Animal Coloring Pages](/animal-coloring-pages/) at ages 4–5. This set keeps reef, boat, and pattern pages together.',
    FOOTER,
  ].join('\n\n'),
  'first-animal-coloring-pages': [
    'These pages are drawn for about ages 2 to 3. One huge animal per page with extra-thick outlines.',
    'When your child is ready for more parts, move to [Animal Coloring Pages](/animal-coloring-pages/) (ages 3–8).',
    FOOTER,
  ].join('\n\n'),
  'dinosaur-scene-coloring-pages': [
    'These pages are drawn for about ages 5 to 6. Dinosaurs with spots, patterns, and small outdoor scenes.',
    'For one smiling dino with thick lines, open [Dinosaur Coloring Pages](/dinosaur-coloring-pages/) (ages 3–4).',
    FOOTER,
  ].join('\n\n'),
};

export function themeBodyIsBoilerplate(body: string): boolean {
  const text = body.trim();
  if (!text) return true;
  if (/^This collection features\b/i.test(text)) return true;
  if (/^Download the PDF, not a screenshot of this page\.?$/i.test(text)) return true;
  if (text === 'These pages are grouped by age. Pick the group that matches how long your child will sit.\n\nDownload the PDF, not a screenshot of this page.') {
    return true;
  }
  return false;
}

export function buildThemeBody(
  _collectionTitle: string,
  _sheetTitles: string[],
  extra?: { ageSpan?: string; multiAge?: boolean },
): string {
  const lines = [FOOTER];
  if (extra?.ageSpan && extra.multiAge) {
    lines.unshift(
      `Pages are sorted by age (${extra.ageSpan}). Match the lines to your child, not only the birthday.`,
    );
  } else if (extra?.ageSpan) {
    lines.unshift(`These pages are drawn for ${extra.ageSpan}.`);
  }
  return lines.join('\n\n');
}
