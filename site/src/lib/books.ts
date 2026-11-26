export type BookOffer = {
  id: string;
  title: string;
  body: string;
  /** Optional clearer copy on specific theme pages (same book, different free lineup). */
  bodyByTheme?: Partial<Record<string, string>>;
  /** Sidebar on a single free sheet page */
  sheetPromo: string;
  cover: string;
  coverAlt: string;
  amazonUrl: string;
  kofiUrl: string;
  pages: number;
  price: string;
  pdfPrice: string;
  paperbackPrice: string;
  themes: string[];
};

export const books: BookOffer[] = [
  {
    id: 'winter-christmas',
    title: 'Winter & Christmas book',
    body: 'Pick free pages here anytime. For 50 winter and Christmas pictures in one file, already in order, use the PDF or the paperback.',
    sheetPromo: '50-page winter and Christmas book. The full stack in one PDF, not one page at a time.',
    cover: '/books/adorable-winter-christmas-coloring-book.jpg',
    coverAlt: 'Cover of Adorable Winter Coloring Book: two children ice skating in the snow',
    amazonUrl: 'https://www.amazon.com/dp/B0HMMBW1F6',
    kofiUrl: 'https://ko-fi.com/s/53304342a5',
    pages: 50,
    price: '$5.99',
    pdfPrice: '$5.99',
    paperbackPrice: '$9.99',
    themes: ['winter-coloring-pages', 'christmas-coloring-pages'],
  },
  {
    id: 'christian-christmas',
    title: 'Christian Christmas book',
    body: 'Print nativity and verse pages free on the site. The book is 35 pages in one PDF or paperback, from simple stars up to fuller scenes.',
    sheetPromo: '35-page Christian Christmas book. The whole set in one file.',
    cover: '/books/cristian-christmas-coloring-book.jpg',
    coverAlt: 'Cover of Cristian Christmass Coloring Book: from the Nativity story to the family traditions',
    amazonUrl: 'https://www.amazon.com/dp/B0HP9YGF6H',
    kofiUrl: 'https://ko-fi.com/s/0d6b5ac6dc',
    pages: 35,
    price: '$3.99',
    pdfPrice: '$3.99',
    paperbackPrice: '$7.99',
    themes: ['christian-christmas-coloring-pages'],
  },
  {
    id: 'garden-animals',
    title: 'Garden animals book (60 pages)',
    body: 'Free pages here are samples. The book is sixty garden-animal pictures in one stack, PDF to print at home or paperback by mail, already in order.',
    bodyByTheme: {
      'garden-coloring-pages':
        'Free here: garden tools, a snail, and a kitten in a pot. The book is sixty garden-animal pages in one PDF or paperback, a separate full set.',
      'animal-coloring-pages':
        'One animal prints free at a time. The garden animals book is sixty pages in one file, not extra copies of this page.',
    },
    sheetPromo: '60-page garden animals book. A full set of garden animals, not the same as the free tool pages on this site.',
    cover: '/books/cute-garden-animals-coloring-book.jpg',
    coverAlt: 'Cover of Cute Garden Animals Coloring Book: a snail on a watering can and a chick with a rake',
    amazonUrl: 'https://www.amazon.com/dp/B0HMJPQXPT',
    kofiUrl: 'https://ko-fi.com/s/b535114e98',
    pages: 60,
    price: '$5.99',
    pdfPrice: '$5.99',
    paperbackPrice: '$9.99',
    themes: ['garden-coloring-pages', 'animal-coloring-pages'],
  },
  {
    id: 'fall-thanksgiving',
    title: 'Fall & Thanksgiving book',
    body: 'Free harvest pages are here. For 50 fall and Thanksgiving pictures in one PDF or paperback, use the book.',
    sheetPromo: '50-page fall and Thanksgiving book. The full set in one file.',
    cover: '/books/cover-thanksgiving.jpg',
    coverAlt: 'Cover of Thanksgiving Coloring Book: a funny turkey and pumpkins',
    amazonUrl: 'https://www.amazon.com/dp/B0HNT32W6L',
    kofiUrl: 'https://ko-fi.com/s/4c5ffb1795',
    pages: 50,
    price: '$5.99',
    pdfPrice: '$5.99',
    paperbackPrice: '$9.99',
    themes: ['fall-coloring-pages', 'thanksgiving-coloring-pages'],
  },
  {
    id: 'cinderella',
    title: 'Cinderella book (50 pages)',
    body: 'Fairy Tales has two Cinderella scenes free. The book is the full Perrault story in fifty pages, one PDF to print at home.',
    bodyByTheme: {
      'fairy-tales-coloring-pages':
        'Two Cinderella scenes are free here. The book is fifty pages through the whole tale, one PDF.',
      'princess-coloring-pages':
        'Generic princess pages are free here. The Cinderella book is fifty story pages in one PDF, not more of this lineup.',
    },
    sheetPromo: '50-page Cinderella book. The whole story in order, not just the two free scenes on the site.',
    cover: '/books/cinderella-book.jpg',
    coverAlt: 'Cover of Cinderella Coloring Book: Cinderella by the fire, and the ball before the clock strikes midnight',
    amazonUrl: '',
    kofiUrl: 'https://ko-fi.com/s/452102199d',
    pages: 50,
    price: '$5.99',
    pdfPrice: '$5.99',
    paperbackPrice: '',
    themes: ['fairy-tales-coloring-pages', 'princess-coloring-pages'],
  },
];

export function bookForTheme(themeId: string) {
  const book = books.find((item) => item.themes.includes(themeId));
  if (!book) return undefined;
  const body = book.bodyByTheme?.[themeId] ?? book.body;
  return { ...book, body };
}