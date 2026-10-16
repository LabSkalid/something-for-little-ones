import { chat } from './openrouter.ts';
import { loadEnv } from './env.ts';

export type PinCopyInput = {
  filename: string;
  type: 'single' | 'collection';
  themeTitle: string;
  url: string;
  sheetTitle?: string;
  sheetDescription?: string;
  age?: string;
};

export type PinCopyResult = {
  filename: string;
  pinTitle: string;
  pinDescription: string;
};

function extractJsonArray(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('Модель не вернула JSON-массив для пинов.');
  return JSON.parse(raw.slice(start, end + 1)) as Array<Record<string, string>>;
}

/** Cheap text-only copy for Pinterest. Does not look at or redraw pin images. */
export async function writePinterestCopy(
  pins: PinCopyInput[],
  keywords = '',
): Promise<Map<string, PinCopyResult>> {
  if (!pins.length) return new Map();
  loadEnv();
  const keywordLine = keywords
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 16)
    .join(', ');

  const system = [
    'You write Pinterest pin titles and descriptions for Something for Little Ones.',
    'Voice: an American mom who makes printable coloring pages for her own kids and shares them.',
    'Calm, descriptive, and helpful — like a quiet note to another parent, not an ad.',
    'Reply with JSON only: an array of objects with keys filename, pinTitle, pinDescription.',
    'pinTitle: under 100 characters, plain and specific (what is on the page / who it suits). Not clickbait.',
    'pinDescription: 2-4 short sentences. Describe the page or set, the subject, the feel, and who it is for when age is given.',
    'It is fine to mention these are free printable coloring pages when it fits naturally.',
    'Weave in as many of the given keywords as sound natural in American English; prefer several over one.',
    'Do not use calls to action (no save, pin, click, download now, grab, try, check out, visit, link in bio, follow, share, etc.).',
    'Do not put any website URL, domain, or link in the title or description — the pin link is stored separately.',
    'Do not say the owner drew stock art. Do not invent ages, claims, or movie/trademarked characters.',
    'No hashtags. No ALL CAPS spam. No emoji. No markdown outside the JSON.',
  ].join(' ');

  const user = [
    keywordLine
      ? `Keywords to include naturally (use several when they fit): ${keywordLine}`
      : 'No extra keywords list. Lean on the theme and sheet names as search phrases.',
    'Write copy for these pins (do not include urls):',
    JSON.stringify(
      pins.map((pin) => ({
        filename: pin.filename,
        type: pin.type,
        themeTitle: pin.themeTitle,
        sheetTitle: pin.sheetTitle ?? '',
        sheetDescription: pin.sheetDescription ?? '',
        age: pin.age ?? '',
      })),
      null,
      2,
    ),
  ].join('\n');

  const reply = await chat(system, user);
  const rows = extractJsonArray(reply);
  const map = new Map<string, PinCopyResult>();
  const stripUrls = (text: string) =>
    text
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/\b(?:www\.)?somethingforlittleones\.com\S*/gi, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  for (const row of rows) {
    const filename = String(row.filename ?? '').trim();
    if (!filename) continue;
    const pinTitle = stripUrls(String(row.pinTitle ?? row.title ?? '').trim());
    const pinDescription = stripUrls(String(row.pinDescription ?? row.description ?? '').trim());
    if (!pinTitle || !pinDescription) continue;
    map.set(filename, { filename, pinTitle, pinDescription });
  }
  if (!map.size) throw new Error('Модель не вернула тексты для пинов.');
  return map;
}
