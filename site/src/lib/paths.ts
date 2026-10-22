export function themePath(themeId: string) {
  return `/${themeId}/`;
}

export function sheetPath(themeId: string, slug: string) {
  return `/${themeId}/${slug}/`;
}

export function sheetAssets(themeId: string, slug: string) {
  return {
    png: `https://files.somethingforlittleones.com/print/${themeId}/${slug}.png`,
    letter: `https://files.somethingforlittleones.com/print/${themeId}/${slug}-us-letter.pdf`,
    a4: `https://files.somethingforlittleones.com/print/${themeId}/${slug}-a4.pdf`,
  };
}

export function pinPath(themeId: string, pinId: string) {
  return `/pins/${themeId}-${pinId}.png`;
}
