export const site = {
  name: 'Something for Little Ones',
  tagline: 'Free coloring pages',
  url: 'https://somethingforlittleones.com',
  email: 'hello@somethingforlittleones.com',
  description:
    'Free coloring pages to print, sorted by age from 2 to 8. Huge shapes for ages 2–3, simple sets for ages 3–4, and fuller scenes through age 8. US Letter and A4 PDFs.',
  locale: 'en-US',
} as const;

/** Pixel size of every file in /pins. */
export const pinPng = { width: 1000, height: 1500 } as const;

/** Pixel size of every coloring-page PNG in /print. */
export const sheetPng = { width: 1000, height: 1310 } as const;

export function absoluteUrl(path: string) {
  return new URL(path, site.url).href;
}
