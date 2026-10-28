export function themePath(themeId: string) {
  return `/${themeId}/`;
}

export function sheetPath(themeId: string, slug: string) {
  return `/${themeId}/${slug}/`;
}

export function sheetAssets(themeId: string, slug: string) {
  const base = import.meta.env.DEV
    ? '/print'
    : 'https://files.somethingforlittleones.com/print';
  return {
    png: `${base}/${themeId}/${slug}.png`,
    letter: `${base}/${themeId}/${slug}-us-letter.pdf`,
    a4: `${base}/${themeId}/${slug}-a4.pdf`,
  };
}

export function pinPath(themeId: string, pinId: string) {
  return `/pins/${themeId}-${pinId}.png`;
}
