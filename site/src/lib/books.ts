export type BookOffer = {
  id: string;
  title: string;
  body: string;
  cover: string;
  coverAlt: string;
  amazonUrl: string;
  kofiUrl: string;
  /** Theme pages where this offer appears in the rail. */
  themes: string[];
};

export const books: BookOffer[] = [
  {
    id: 'winter-christmas',
    title: 'A ready coloring book',
    body: 'More winter and Christmas pages that aren’t free on the site: already in one stack, ready to color. A real book in the mail, or a PDF to print at home.',
    cover: '/books/adorable-winter-christmas-coloring-book.png',
    coverAlt: 'Cover of Adorable Winter Coloring Book: two children ice skating in the snow',
    amazonUrl: 'https://www.amazon.com/dp/B0HMMBW1F6',
    kofiUrl: 'https://ko-fi.com/s/53304342a5',
    themes: ['winter-coloring-pages', 'christmas-coloring-pages'],
  },
  {
    id: 'garden-animals',
    title: 'A ready coloring book',
    body: 'More garden animal pages that aren’t free on the site: already in one stack, ready to color. A real book in the mail, or a PDF to print at home.',
    cover: '/books/cute-garden-animals-coloring-book.png',
    coverAlt: 'Cover of Cute Garden Animals Coloring Book: a snail on a watering can and a chick with a rake',
    amazonUrl: 'https://www.amazon.com/dp/B0HMJPQXPT',
    kofiUrl: 'https://ko-fi.com/s/b535114e98',
    themes: ['garden-coloring-pages', 'animal-coloring-pages'],
  },
   {
    id: 'fall-thanksgiving',
    title: 'A ready coloring book',
    body: 'More fall and Thanksgiving pages that aren’t free on the site: already in one stack, ready to color. A real book in the mail, or a PDF to print at home.',
    cover: '/books/cover-thanksgiving.png',
    coverAlt: 'Cover of Thanksgiving Coloring Book: a funny turkey and pumpkins',
    amazonUrl: 'https://www.amazon.com/dp/B0HNT32W6L',
    kofiUrl: 'https://ko-fi.com/s/4c5ffb1795',
    themes: ['fall-coloring-pages', 'thanksgiving-coloring-pages'],
  },
];

export function bookForTheme(themeId: string) {
  return books.find((book) => book.themes.includes(themeId));
}
