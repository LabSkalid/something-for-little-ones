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
    .slice(0, 8)
    .join(', ');

  const system = [
    'You write Pinterest pin titles and descriptions for Something for Little Ones,',
    'a small American mom website with free printable coloring pages.',
    'Reply with JSON only: an array of objects with keys filename, pinTitle, pinDescription.',
    'pinTitle: under 100 characters, clear, natural, not clickbait.',
    'pinDescription: 1-3 short sentences, warm kitchen-table tone, mention it is free to print,',
    'naturally use 1-3 of the given keywords if they fit, then end with the exact destination URL on its own line.',
    'Do not say the owner drew stock art. Do not invent claims, ages that were not given, or movie characters.',
    'No hashtag walls. No ALL CAPS spam. No markdown outside the JSON.',
  ].join(' ');

  const user = [
    keywordLine ? `Keywords to weave in when natural: ${keywordLine}` : 'No extra keywords. Use the theme and sheet names.',
    'Pins:',
    JSON.stringify(
      pins.map((pin) => ({
        filename: pin.filename,
        type: pin.type,
        themeTitle: pin.themeTitle,
        sheetTitle: pin.sheetTitle ?? '',
        sheetDescription: pin.sheetDescription ?? '',
        age: pin.age ?? '',
        url: pin.url,
      })),
      null,
      2,
    ),
  ].join('\n');

  const reply = await chat(system, user);
  const rows = extractJsonArray(reply);
  const map = new Map<string, PinCopyResult>();
  for (const row of rows) {
    const filename = String(row.filename ?? '').trim();
    if (!filename) continue;
    const pinTitle = String(row.pinTitle ?? row.title ?? '').trim();
    let pinDescription = String(row.pinDescription ?? row.description ?? '').trim();
    const source = pins.find((pin) => pin.filename === filename);
    if (source && pinDescription && !pinDescription.includes(source.url)) {
      pinDescription = `${pinDescription}\n${source.url}`;
    }
    if (!pinTitle || !pinDescription) continue;
    map.set(filename, { filename, pinTitle, pinDescription });
  }
  if (!map.size) throw new Error('Модель не вернула тексты для пинов.');
  return map;
}
