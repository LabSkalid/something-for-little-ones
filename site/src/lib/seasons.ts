/** Calendar windows for the homepage “This season” strip. Add theme ids when sets exist. */

export type MonthDay = { month: number; day: number };

export type SeasonWindow = {
  id: string;
  /** Short heading, e.g. "This fall" */
  label: string;
  blurb: string;
  /** Theme collection ids to feature, in display order */
  themeIds: string[];
  /** Inclusive start (1-based month) */
  start: MonthDay;
  /** Inclusive end; may wrap past New Year when end is before start in calendar order */
  end: MonthDay;
};

/**
 * Non-overlapping windows. First match wins.
 * Empty themeIds = window reserved for later (Valentine, Easter, summer, etc.).
 */
export const seasonWindows: SeasonWindow[] = [
  {
    id: 'valentine',
    label: 'Valentine’s Day',
    blurb: 'Sweet printable pages for February.',
    themeIds: [],
    start: { month: 2, day: 1 },
    end: { month: 2, day: 16 },
  },
  {
    id: 'spring',
    label: 'This spring',
    blurb: 'Spring and Easter pages when you want something fresh to print.',
    themeIds: [],
    start: { month: 3, day: 1 },
    end: { month: 5, day: 15 },
  },
  {
    id: 'summer',
    label: 'This summer',
    blurb: 'Beach, ocean, and warm-weather pages for long afternoons.',
    themeIds: [],
    // ocean-scene is evergreen for now; swap in seasonal summer ids when ready
    start: { month: 6, day: 1 },
    end: { month: 8, day: 20 },
  },
  {
    id: 'fall',
    label: 'This fall',
    blurb: 'Leaves, friendly Halloween, and Thanksgiving — pick a set, then an age.',
    themeIds: [
      'fall-coloring-pages',
      'halloween-coloring-pages',
      'thanksgiving-coloring-pages',
    ],
    start: { month: 9, day: 1 },
    end: { month: 11, day: 30 },
  },
  {
    id: 'winter',
    label: 'This winter',
    blurb: 'Snowy days, Christmas, and Christian Christmas pages for the season.',
    themeIds: [
      'winter-coloring-pages',
      'christmas-coloring-pages',
      'christian-christmas-coloring-pages',
    ],
    start: { month: 12, day: 1 },
    end: { month: 1, day: 31 },
  },
];

function toDayOfYear(month: number, day: number) {
  // Enough for ordering within a non-leap calendar year (Feb 29 treated as Feb 28 for windows).
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
  // Wraps year (e.g. Dec 1 – Jan 31)
  return t >= a || t <= b;
}

/** Active season for a date. Uses build/runtime local calendar date. */
export function getCurrentSeason(date: Date = new Date()): SeasonWindow | null {
  for (const window of seasonWindows) {
    if (window.themeIds.length === 0) continue;
    if (inWindow(date, window.start, window.end)) return window;
  }
  return null;
}
