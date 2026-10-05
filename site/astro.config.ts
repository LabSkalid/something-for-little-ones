import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import fs from 'node:fs/promises';
import { site } from './src/site';
import { contentLastmods } from './src/lib/sitemap-lastmod';

const lastmods = contentLastmods();

export default defineConfig({
  site: site.url,
  trailingSlash: 'always',
  integrations: [
    sitemap({
      filter: (page) => {
        const pathname = new URL(page).pathname;
        return pathname !== '/404/' && pathname !== '/404';
      },
      serialize(item) {
        let pathname = new URL(item.url).pathname;
        if (pathname !== '/' && !pathname.endsWith('/')) pathname += '/';
        const lastmod = lastmods.get(pathname);
        if (lastmod) item.lastmod = lastmod;
        return item;
      },
    }),
    {
      name: 'ads-txt',
      hooks: {
        'astro:build:done': async ({ dir }) => {
          const pub = process.env.PUBLIC_ADSENSE_PUB ?? '';
          const file = new URL('ads.txt', dir);
          if (/^pub-\d+$/.test(pub)) {
            await fs.writeFile(file, `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`);
          } else {
            await fs.rm(file, { force: true });
          }
        },
      },
    },
  ],
});
