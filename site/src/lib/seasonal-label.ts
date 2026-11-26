/** Calendar-season collections (not a named holiday). Add summer id when the set exists. */
const SEASON_THEME_IDS = new Set([
  'spring-coloring-pages',
  'fall-coloring-pages',
  'winter-coloring-pages',
]);

/** Eyebrow on seasonal theme cards and collection pages. */
export function seasonalCollectionEyebrow(themeId: string): 'Season' | 'Holiday' {
  return SEASON_THEME_IDS.has(themeId) ? 'Season' : 'Holiday';
}