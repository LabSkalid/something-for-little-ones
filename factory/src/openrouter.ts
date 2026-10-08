import { readSite } from './brand.ts';

type ImagePayload = {
  data?: { b64_json?: string; url?: string }[];
  error?: { message?: string };
};

export type LineDifficulty = 'toddler' | 'easy' | 'medium' | 'detailed';

function requireKey() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error('Нет OPENROUTER_API_KEY. Добавьте ключ в factory/.env и запустите команду снова.');
  }
  return key;
}

async function post(path: string, body: unknown) {
  const { url, name } = readSite();
  const response = await fetch(`https://openrouter.ai/api/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireKey()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': url,
      'X-Title': name,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter ответил ${response.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as unknown;
}

export async function chat(system: string, user: string) {
  const model = process.env.OPENROUTER_TEXT_MODEL || 'google/gemini-2.5-flash';
  const json = (await post('chat/completions', {
    model,
    temperature: 0.6,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  })) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Текстовая модель вернула пустой ответ.');
  return content;
}

/** Cheap vision/text call. Looks at an image; does not redraw it. */
export async function visionChat(system: string, user: string, imagePng: Buffer, mime = 'image/png') {
  const model =
    process.env.OPENROUTER_VISION_MODEL ||
    process.env.OPENROUTER_TEXT_MODEL ||
    'google/gemini-2.5-flash';
  const json = (await post('chat/completions', {
    model,
    temperature: 0.3,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: user },
          {
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${imagePng.toString('base64')}` },
          },
        ],
      },
    ],
  })) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Vision-модель вернула пустой ответ.');
  return content;
}

export async function generateColoringPage(prompt: string) {
  const model = process.env.OPENROUTER_IMAGE_MODEL || 'openai/gpt-image-2';
  const quality = process.env.OPENROUTER_IMAGE_QUALITY || 'medium';
  const json = (await post('images', {
    model,
    prompt,
    aspect_ratio: '2:3',
    resolution: '1K',
    quality,
    output_format: 'png',
    n: 1,
  })) as ImagePayload;
  if (json.error?.message) throw new Error(json.error.message);
  const image = json.data?.[0];
  if (image?.b64_json) return Buffer.from(image.b64_json, 'base64');
  if (image?.url) {
    const file = await fetch(image.url);
    if (!file.ok) throw new Error(`Не удалось скачать картинку: ${file.status}`);
    return Buffer.from(await file.arrayBuffer());
  }
  throw new Error('В ответе OpenRouter нет картинки.');
}

const layouts: Record<LineDifficulty, string> = {
  toddler:
    'One object only, made of very few huge closed shapes. Extra-thick outlines. Almost no small parts and no background scene. Leave lots of white space. A toddler should be able to scribble across each shape.',
  easy:
    'One subject, large and centered, with white space around it. Thick closed outlines and a handful of big regions. A young child should be able to color every region with a crayon.',
  medium:
    'A simple scene with more separate regions than a single centered object. Include medium-size details a child can color one at a time. Keep outlines thick, closed, and even. Do not fill the background with tiny hairline marks.',
  detailed:
    'A fuller scene or a repeating pattern with many separate regions to color. The picture can use more of the page. Outlines stay bold and closed, clearly thick enough to print and color with a crayon, never hairline engraving, never crosshatching, never gray fill.',
};

export function coloringPrompt(
  style: string,
  subject: string,
  difficulty: LineDifficulty = 'easy',
  age = '3-4',
) {
  const ages = age.replace('-', ' to ');
  let layout = layouts[difficulty] ?? layouts.easy;
  if (difficulty === 'detailed' && age.startsWith('6')) {
    layout +=
      ' Make this busier than a simple scene: more objects, a repeating pattern, and smaller regions that are still easy to see on paper. Do not switch to hairline pen work.';
  }
  return [
    `A finished coloring-book page for children ages ${ages}, portrait composition.`,
    `Subject: ${subject}.`,
    style,
    'Draw it the way a coloring book is printed: pure white background, solid black outlines only, even line weight, smooth closed shapes, clean corners, no stray sketch lines.',
    layout,
    'No shading, no gray, no hatching, no gradients, no color, no texture, no paper grain, no shadow, no frame, no border.',
    'No letters, numbers, captions, logos, or watermarks anywhere in the picture. Leave the drawing itself untitled.',
    'Original subject only. Do not imitate a character from a film, series, game, or toy line.',
  ].join(' ');
}
