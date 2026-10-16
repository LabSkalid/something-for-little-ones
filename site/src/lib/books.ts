export type BookOffer = {
  id: string;
  title: string;
  body: string;
  amazonUrl: string;
  kofiUrl: string;
  /** Theme pages where this offer appears in the rail. */
  themes: string[];
};

export const books: BookOffer[] = [
  {
    id: 'winter-christmas',
    title: 'A ready coloring book',
    body: 'More winter and Christmas pages that aren’t free on the site: already in one stack, ready to color. Paperback on Amazon if you want a real book in the mail. PDF on Ko-fi if you’d rather print the pages at home.',
    amazonUrl: 'https://www.amazon.com/dp/B0HMMBW1F6',
    kofiUrl: 'https://ko-fi.com/s/53304342a5',
    themes: ['winter-coloring-pages', 'christmas-coloring-pages'],
  },
];

export function bookForTheme(themeId: string) {
  return books.find((book) => book.themes.includes(themeId));
}
