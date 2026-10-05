import type { APIRoute } from 'astro';
import { site } from '../site';

const bots = [
  'Googlebot',
  'Bingbot',
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'Google-Extended',
  'PerplexityBot',
  'ClaudeBot',
  'anthropic-ai',
  'Applebot',
  'Applebot-Extended',
  'Amazonbot',
  'CCBot',
];

export const GET: APIRoute = () => {
  const groups = ['User-agent: *\nAllow: /', ...bots.map((bot) => `User-agent: ${bot}\nAllow: /`)];
  const body = `${groups.join('\n\n')}\n\nSitemap: ${site.url}/sitemap-index.xml\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
