import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import fs from 'node:fs/promises';
import { site } from './src/site';

export default defineConfig({
  site: site.url,
  trailingSlash: 'always',
  integrations: [
    sitemap(),
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
