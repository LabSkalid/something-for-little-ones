export const site = {
  name: 'Something for Little Ones',
  tagline: 'Free coloring pages',
  url: 'https://somethingforlittleones.com',
  email: 'hello@somethingforlittleones.com',
  description:
    'Free coloring pages to print for kids. Animals, dinosaurs, cars, princesses, fall, Halloween, and Christmas in US Letter and A4 PDFs.',
  locale: 'en-US',
} as const;

export function absoluteUrl(path: string) {
  return new URL(path, site.url).href;
}
