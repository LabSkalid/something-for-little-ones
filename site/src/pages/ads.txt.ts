import type { APIRoute } from 'astro';

export const GET: APIRoute = () => {
  const pub = import.meta.env.PUBLIC_ADSENSE_PUB ?? '';
  if (!/^pub-\d+$/.test(pub)) {
    return new Response('Not found', { status: 404 });
  }
  return new Response(`google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
