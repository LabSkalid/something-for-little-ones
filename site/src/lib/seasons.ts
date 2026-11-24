/** Calendar windows for the homepage "season" strip. */

export type MonthDay = { month: number; day: number };

export type SeasonWindow = {
  id: string;
  /** Heading for the homepage strip (also an H2, so keep it keyword-friendly) */
  label: string;
  blurb: string;
  /** Theme ids to feature, in display order. Ids that don't exist yet are skipped. */
  themeIds: string[];
  /** Inclusive start (1-based month) */
  start: MonthDay;
  /** Inclusive end; may wrap past New Year */
  end: MonthDay;
};

/**
 * Non-overlapping windows covering the whole year. First match wins.
 * Moving holidays use wide windows: Easter falls between Mar 22 and Apr 25,
 * Mother's Day on May 8–14, Father's Day on Jun 15–21, Thanksgiving on Nov 22–28.
 * Themes are looked up in ALL themes (seasonal or everyday), so evergreen sets
 * like ocean scenes can appear in summer.
 */
export const seasonWindows: SeasonWindow[] = [
  {
    id: 'winter',
    label: 'Winter coloring pages',
    blurb: 'Snowy days and cozy pages for the first weeks of the year.',
    themeIds: ['winter-coloring-pages'],
    start: { month: 12, day: 26 },
    end: { month: 1, day: 14 },
  },
  {
    id: 'valentine',
    label: 'Valentine’s Day coloring pages',
    blurb: 'Sweet printable pages for February, plus cozy winter sets.',
    themeIds: ['valentine-s-day-coloring-pages', 'winter-coloring-pages'],
    start: { month: 1, day: 15 },
    end: { month: 2, day: 15 },
  },
  {
    id: 'early-spring',
    label: 'St. Patrick’s Day coloring pages',
    blurb: 'Shamrocks, spring flowers, and early Easter pages.',
    themeIds: ['st-patrick-s-day-coloring-pages', 'easter-coloring-pages', 'spring-coloring-pages'],
    start: { month: 2, day: 16 },
    end: { month: 3, day: 17 },
  },
  {
    id: 'easter',
    label: 'Easter coloring pages',
    blurb: 'Bunnies, eggs, and spring pictures to print and color.',
    themeIds: ['easter-coloring-pages', 'spring-coloring-pages', 'earth-day-coloring-pages'],
    start: { month: 3, day: 18 },
    end: { month: 4, day: 25 },
  },
  {
    id: 'mothers-day',
    label: 'Mother’s Day coloring pages',
    blurb: 'Simple pages kids can color as a gift.',
    themeIds: ['mothers-day-coloring-pages', 'spring-coloring-pages'],
    start: { month: 4, day: 26 },
    end: { month: 5, day: 14 },
  },
  {
    id: 'early-summer',
    label: 'Summer coloring pages',
    blurb: 'Beach, ocean, and warm-weather pages for long afternoons.',
    themeIds: ['summer-coloring-pages', 'fathers-day-coloring-pages', 'ocean-scene-coloring-pages'],
    start: { month: 5, day: 15 },
    end: { month: 6, day: 21 },
  },
  {
    id: 'july-4',
    label: 'Fourth of July coloring pages',
    blurb: 'Red, white, and blue pages for the holiday.',
    themeIds: ['4th-of-july-coloring-pages', 'summer-coloring-pages'],
    start: { month: 6, day: 22 },
    end: { month: 7, day: 5 },
  },
  {
    id: 'back-to-school',
    label: 'Back to school coloring pages',
    blurb: 'Pages for the first days of school and the last days of summer.',
    themeIds: ['back-to-school-coloring-pages', 'summer-coloring-pages', 'ocean-scene-coloring-pages'],
    start: { month: 7, day: 6 },
    end: { month: 8, day: 31 },
  },
  {
    id: 'fall',
    label: 'Fall coloring pages',
    blurb: 'Leaves and friendly Halloween pages. Pick a set, then an age.',
    themeIds: ['fall-coloring-pages', 'halloween-coloring-pages'],
    start: { month: 9, day: 1 },
    end: { month: 10, day: 14 },
  },
  {
    id: 'halloween',
    label: 'Halloween coloring pages',
    blurb: 'Friendly Halloween pages, with Thanksgiving coming up.',
    themeIds: ['halloween-coloring-pages', 'thanksgiving-coloring-pages', 'fall-coloring-pages'],
    start: { month: 10, day: 15 },
    end: { month: 10, day: 31 },
  },
  {
    id: 'thanksgiving',
    label: 'Thanksgiving coloring pages',
    blurb: 'Turkeys, harvest pages, and fall favorites.',
    themeIds: ['thanksgiving-coloring-pages', 'fall-coloring-pages'],
    start: { month: 11, day: 1 },
    end: { month: 11, day: 14 },
  },
  {
    id: 'thanksgiving-christmas',
    label: 'Thanksgiving coloring pages',
    blurb: 'Thanksgiving pages for the kids’ table, plus the first Christmas sets.',
    themeIds: [
      'thanksgiving-coloring-pages',
      'christmas-coloring-pages',
      'christian-christmas-coloring-pages',
    ],
    start: { month: 11, day: 15 },
    end: { month: 11, day: 28 },
  },
  {
    id: 'christmas',
    label: 'Christmas coloring pages',
    blurb: 'Christmas, Christian Christmas, and snowy winter pages.',
    themeIds: [
      'christmas-coloring-pages',
      'christian-christmas-coloring-pages',
      'winter-coloring-pages',
    ],
    start: { month: 11, day: 29 },
    end: { month: 12, day: 25 },
  },
];

function toDayOfYear(month: number, day: number) {
  // Feb 29 is treated as Feb 28 for windows.
  const lengths = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let n = day;
  for (let m = 1; m < month; m++) n += lengths[m];
  return n;
}

function inWindow(date: Date, start: MonthDay, end: MonthDay) {
  const t = toDayOfYear(date.getMonth() + 1, date.getDate());
  const a = toDayOfYear(start.month, start.day);
  const b = toDayOfYear(end.month, end.day);
  if (a <= b) return t >= a && t <= b;
  // Wraps the year (e.g. Dec 26 – Jan 14)
  return t >= a || t <= b;
}

/**
 * Active season for a date. Pass the ids of existing themes so ids that don't exist yet
 * are dropped. If no listed theme exists for the matching window, returns null.
 */
export function getCurrentSeason(
  date: Date = new Date(),
  availableIds?: Iterable<string>,
): SeasonWindow | null {
  const available = availableIds ? new Set(availableIds) : null;
  for (const window of seasonWindows) {
    if (!inWindow(date, window.start, window.end)) continue;
    const themeIds = available
      ? window.themeIds.filter((id) => available.has(id))
      : window.themeIds;
    return themeIds.length > 0 ? { ...window, themeIds } : null;
  }
  return null;
}