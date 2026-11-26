export type BookOffer = {
  id: string;
  title: string;
  body: string;
  bodyByTheme?: Partial<Record<string, string>>;
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
    title: 'Adorable Winter & Christmas Coloring Book',
    body: '50 cute winter and Christmas coloring pages. Snowy play, cozy scenes, trees, presents, and holiday fun.',
    bodyByTheme: {
      'winter-coloring-pages':
        '50 adorable winter and Christmas coloring pages in one book. Cozy seasonal art for quiet afternoons.',
      'christmas-coloring-pages':
        '50 adorable winter and Christmas coloring pages in one book. Holiday trees, presents, and festive scenes.',
    },
    sheetPromo: '50 winter and Christmas pages in one book.',
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
    title: 'Christmas Coloring Book for Kids',
    body: 'The Nativity, family Christmas traditions, and acts of kindness, in 35 coloring pages for ages 5–8. Celebrate the meaning of Christmas one picture at a time.',
    sheetPromo: '35-page Christmas story and traditions book.',
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
    title: 'Cute Garden Animals Coloring Book',
    body: '60 charming garden-animal scenes with flowers, plants, and outdoor fun. A screen-free treat for little animal lovers ages 4–8.',
    bodyByTheme: {
      'garden-coloring-pages':
        '60 garden-animal coloring pages in this book. Different art from the free garden-tool pages here.',
      'animal-coloring-pages':
        '60 garden-animal coloring pages in this book. Charming yard scenes, not the same art as these free pages.',
    },
    sheetPromo: '60 garden-animal pages in one book.',
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
    title: 'Thanksgiving Coloring Book for Kids',
    body: '50 cute Thanksgiving coloring pages for ages 4–8. Turkeys, pumpkins, autumn fun, and cozy family scenes.',
    bodyByTheme: {
      'fall-coloring-pages':
        '50 Thanksgiving coloring pages in one book. Cute fall and holiday art for ages 4–8.',
      'thanksgiving-coloring-pages':
        '50 Thanksgiving coloring pages in one book. Festive scenes for Thanksgiving break.',
    },
    sheetPromo: '50 Thanksgiving pages, ages 4–8.',
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
    title: 'Cinderella Coloring Book',
    body: '50 classic Cinderella coloring pages inspired by Perrault. Follow the fairy tale from the cottage to the ball and happily ever after. Ages 5–8.',
    bodyByTheme: {
      'fairy-tales-coloring-pages':
        '50-page Cinderella story coloring book. The full classic fairy tale, not single free scenes here.',
      'princess-coloring-pages':
        '50-page Cinderella story coloring book. Princess art inspired by the classic fairy tale.',
    },
    sheetPromo: 'Cinderella fairy tale, 50 pages.',
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