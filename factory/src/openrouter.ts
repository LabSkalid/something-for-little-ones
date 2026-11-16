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

const TEXT_TIMEOUT_MS = 180_000;
const IMAGE_TIMEOUT_MS = 180_000;

const IMAGE_GAVE_UP =
  'OpenRouter не ответил за 3 минуты даже после повторной попытки (таймаут или обрыв сети). Генерация остановлена, чтобы задание не зависало молча. Перезапустите фабрику и запустите книгу снова: уже сохранённые страницы будут пропущены.';

class TransientOpenRouterError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TransientOpenRouterError';
  }
}

function isTransientFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TransientOpenRouterError' || error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  if (
    ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET'].includes(code)
  ) {
    return true;
  }
  if (/timeout|timed out|aborted|fetch failed|network|socket hang up|other side closed/i.test(error.message)) return true;
  return error.cause ? isTransientFetchError(error.cause) : false;
}

async function post(path: string, body: unknown, timeoutMs = TEXT_TIMEOUT_MS) {
  const { url, name } = readSite();
  let response: Response;
  try {
    response = await fetch(`https://openrouter.ai/api/v1/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requireKey()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': url,
        'X-Title': name,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isTransientFetchError(error)) {
      throw new TransientOpenRouterError(
        `OpenRouter не ответил за ${Math.round(timeoutMs / 1000)} с или сеть оборвалась.`,
        { cause: error },
      );
    }
    throw error;
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter ответил ${response.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as unknown;
}

async function fetchImageBytes(fileUrl: string, timeoutMs: number, failLabel: string) {
  try {
    const file = await fetch(fileUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!file.ok) throw new Error(`${failLabel}: ${file.status}`);
    return Buffer.from(await file.arrayBuffer());
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(failLabel)) throw error;
    if (isTransientFetchError(error)) {
      throw new TransientOpenRouterError(`${failLabel}: сеть оборвалась или истёк лимит ожидания.`, { cause: error });
    }
    throw error;
  }
}

/** One retry for a paid image call. A second timeout or network failure stops the job. */
async function withImageRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isTransientFetchError(error)) throw error;
    console.log('OpenRouter не ответил вовремя или сеть оборвалась. Повторяю запрос картинки один раз.');
    try {
      return await run();
    } catch (again) {
      if (!isTransientFetchError(again)) throw again;
      throw new Error(IMAGE_GAVE_UP);
    }
  }
}

export async function chat(system: string, user: string, temperature = 0.6) {
  const model = process.env.OPENROUTER_TEXT_MODEL || 'google/gemini-2.5-flash';
  const json = (await post('chat/completions', {
    model,
    temperature,
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


/** Edit an existing image using it as a visual reference (image-to-image). */
export async function editColoringPage(sourcePng: Buffer, prompt: string) {
  const model = process.env.OPENROUTER_EDIT_IMAGE_MODEL || 'openai/gpt-image-1';
  const quality = process.env.OPENROUTER_IMAGE_QUALITY || 'medium';
  const json = (await withImageRetry(() => post('images', {
    model,
    prompt,
    input_references: [
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${sourcePng.toString('base64')}` },
      },
    ],
    aspect_ratio: 'auto',
    resolution: '1K',
    quality,
    output_format: 'png',
    n: 1,
  }, IMAGE_TIMEOUT_MS))) as ImagePayload;
  if (json.error?.message) throw new Error(json.error.message);
  const image = json.data?.[0];
  if (image?.b64_json) return Buffer.from(image.b64_json, 'base64');
  if (image?.url) return withImageRetry(() => fetchImageBytes(image.url!, IMAGE_TIMEOUT_MS, 'Не удалось скачать отредактированную картинку'));
  throw new Error('В ответе OpenRouter нет отредактированной картинки.');
}

export async function generateColoringPage(prompt: string, references: Buffer[] = [], model = process.env.OPENROUTER_IMAGE_MODEL || 'openai/gpt-image-2') {
  const quality = process.env.OPENROUTER_IMAGE_QUALITY || 'medium';
  const json = (await withImageRetry(() => post('images', {
    model,
    prompt,
    ...(references.length ? {
      input_references: references.map((png) => ({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
      })),
    } : {}),
    aspect_ratio: '2:3',
    resolution: '1K',
    quality,
    output_format: 'png',
    n: 1,
  }, IMAGE_TIMEOUT_MS))) as ImagePayload;
  if (json.error?.message) throw new Error(json.error.message);
  const image = json.data?.[0];
  if (image?.b64_json) return Buffer.from(image.b64_json, 'base64');
  if (image?.url) return withImageRetry(() => fetchImageBytes(image.url!, IMAGE_TIMEOUT_MS, 'Не удалось скачать картинку'));
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
