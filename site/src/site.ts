export const site = {
  name: 'Something for Little Ones',
  tagline: 'Free coloring pages',
  url: 'https://somethingforlittleones.com',
  email: 'hello@somethingforlittleones.com',
  description:
    'Coloring pages to print at home, sorted by how many lines are on the page. Huge shapes for little kids, and fuller pictures up through about age 8.',
  locale: 'en-US',
} as const;

/** Pixel size of every file in /pins. */
export const pinPng = { width: 1000, height: 1500 } as const;

/** Pixel size of every coloring-page PNG in /print. */
export const sheetPng = { width: 1000, height: 1310 } as const;

export function absoluteUrl(path: string) {
  return new URL(path, site.url).href;
}
