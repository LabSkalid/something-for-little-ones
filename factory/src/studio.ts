import { exec, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { createTalePlan, isSafetyRejection, parseStoryboard, softenTaleSubject } from './book-plan.ts';
import { imageSubject, sceneDescription, stripModelNotes } from './tale-prompt.ts';
import { ensureTaleCast, loadTaleCast, missingTaleCast, normalizeCharacters, redrawTaleCast, referenceNote, TALE_IMAGE_MODEL } from './tale-cast.ts';
import { chat, coloringPrompt, generateColoringPage, type LineDifficulty } from './openrouter.ts';
import { fitPortrait } from './lineart.ts';
import {
  buildPins,
  listPinSheets,
  listThemePins,
  readQueueBlock,
  rememberShippedPins,
  removeShippedLocalFiles,
  writePinCopyOnly,
  type PinBuildOptions,
  type PinMode,
} from './build-assets.ts';
import { loadEnv } from './env.ts';
import {
  AGE_BANDS,
  type AgeBand,
  type DraftSheet,
  commitImport,
  matchDraftsToTheme,
  nameDraftWithVision,
  rewriteThemeBody,
  suggestRelated,
  scanImportFolder,
  listThemeSheets,
  publishPrintAssets,
  setSheetAges,
  themeSlug,
} from './import-stock.ts';
import {
  ageStyle,
  currentDrawPrompts,
  defaultDrawPrompts,
  drawPromptFile,
  resetDrawPrompts,
  saveDrawPrompts,
} from './draw-prompts.ts';
import {
  applyImportCaptions,
  buildKdpBook,
  listKdpPages,
  nameKdpPage,
  type KdpPage,
} from './kdp-book.ts';
import { auditKdpFolder } from './kdp-audit.ts';
import { buildKdpCoverTemplate, estimateInteriorPages } from './kdp-cover.ts';
import { buildDownloadPdfFromKdp } from './kdp-download-from-pdf.ts';
import { reorderKdpPdf } from './kdp-reorder.ts';
import { produce } from './produce.ts';
import { redraw } from './redraw.ts';
import { listRefitSheets, refitFromSite } from './refit-site.ts';
import sharp from 'sharp';
import { briefsRoot, factoryRoot, pinRoot, printRoot, sheetContentRoot, themeContentRoot } from './paths.ts';

loadEnv();

const port = 4317;
const uiPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'studio-ui.html');

type Job = {
  running: boolean;
  log: string[];
  error: string;
  drafts: DraftSheet[] | null;
  kdpPages: KdpPage[] | null;
  lastTheme: string;
  lastKdpPageCount: number;
  folder: string;
};

const job: Job = {
  running: false,
  log: [],
  error: '',
  drafts: null,
  kdpPages: null,
  lastTheme: '',
  lastKdpPageCount: 0,
  folder: '',
};
const sessionPath = path.join(factoryRoot, '.cache', 'studio-session.json');

type StudioSession = {
  drafts: DraftSheet[] | null;
  kdpPages: KdpPage[] | null;
  lastTheme: string;
  lastKdpPageCount: number;
  folder: string;
  savedAt: string;
};

async function saveSession() {
  try {
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    const payload: StudioSession = {
      drafts: job.drafts,
      kdpPages: job.kdpPages,
      lastTheme: job.lastTheme,
      lastKdpPageCount: job.lastKdpPageCount,
      folder: job.folder,
      savedAt: new Date().toISOString(),
    };
    await fs.writeFile(sessionPath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.error('Не удалось сохранить сессию фабрики:', error);
  }
}

async function loadSession() {
  try {
    const raw = await fs.readFile(sessionPath, 'utf8');
    const data = JSON.parse(raw) as Partial<StudioSession>;
    if (Array.isArray(data.drafts)) job.drafts = data.drafts as DraftSheet[];
    if (Array.isArray(data.kdpPages)) job.kdpPages = data.kdpPages as KdpPage[];
    if (typeof data.lastTheme === 'string') job.lastTheme = data.lastTheme;
    if (typeof data.lastKdpPageCount === 'number') job.lastKdpPageCount = data.lastKdpPageCount;
    if (typeof data.folder === 'string') job.folder = data.folder;
    const n = (job.drafts?.length ?? 0) + (job.kdpPages?.length ?? 0);
    if (n) {
      console.log(
        `Восстановлена сессия: импорт ${job.drafts?.length ?? 0}, KDP ${job.kdpPages?.length ?? 0}` +
          (data.savedAt ? ` (${data.savedAt})` : ''),
      );
    }
  } catch {
    // no session yet
  }
}

function frontmatter(raw: string) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  return parse(match[1]) as Record<string, unknown>;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

const boardsPath = path.join(factoryRoot, 'scripts', 'boards.json');

type PinBoardRow = { key: string; board?: string; boardId?: string; tier?: number; weight?: number };

async function readPinBoards(): Promise<{ siteBase?: string; imageBase?: string; themes: PinBoardRow[] }> {
  const raw = await fs.readFile(boardsPath, 'utf8');
  const cfg = JSON.parse(raw.replace(/^\uFEFF/, '')) as { siteBase?: string; imageBase?: string; themes?: PinBoardRow[] };
  return { ...cfg, themes: Array.isArray(cfg.themes) ? cfg.themes : [] };
}

function themeKeyFromSlug(slug: string) {
  return slug.trim().toLowerCase().replace(/-coloring-pages$/, '');
}

async function savePinBoardId(slug: string, boardId: string) {
  const key = themeKeyFromSlug(slug);
  if (!key) throw new Error('Нет темы.');
  const id = String(boardId ?? '').trim();
  if (id && !/^\d+$/.test(id)) throw new Error('ID доски — только цифры из ссылки Pinterest.');
  const cfg = await readPinBoards();
  const existing = cfg.themes.find((row) => row.key === key);
  if (existing) existing.boardId = id;
  else cfg.themes.push({ key, board: key, boardId: id, tier: 2, weight: 1 });
  await fs.writeFile(boardsPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  return { key, boardId: id };
}

async function listThemes() {
  const files = (await fs.readdir(themeContentRoot)).filter((name) => name.endsWith('.md'));
  const boards = await readPinBoards().catch(() => ({ themes: [] as PinBoardRow[] }));
  const boardByKey = new Map(boards.themes.map((row) => [row.key, String(row.boardId ?? '').trim()]));
  const themes = [];
  for (const file of files) {
    const slug = file.replace(/\.md$/, '');
    const data = frontmatter(await fs.readFile(path.join(themeContentRoot, file), 'utf8'));
    let count = 0;
    try {
      count = (await fs.readdir(path.join(sheetContentRoot, slug))).filter((name) => name.endsWith('.md')).length;
    } catch {
      count = 0;
    }
    themes.push({
      slug,
      title: String(data.title ?? slug),
      kind: String(data.kind ?? 'evergreen'),
      accent: String(data.accent ?? '#1d7ad6'),
      count,
      boardId: boardByKey.get(themeKeyFromSlug(slug)) ?? '',
    });
  }
  themes.sort((a, b) => a.title.localeCompare(b.title));
  return themes;
}

const ageDifficulty: Record<string, 'toddler' | 'easy' | 'medium' | 'detailed'> = {
  '2-3': 'toddler',
  '3-4': 'easy',
  '4-5': 'easy',
  '5-6': 'medium',
  '6-8': 'detailed',
};

function parseIdeas(text: string, age = '3-4') {
  const band = ageDifficulty[age] ? age : '3-4';
  const difficulty = ageDifficulty[band];
  const used = new Set<string>();
  const ideas = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const splitAt = line.indexOf(':');
    const name = stripModelNotes((splitAt === -1 ? line : line.slice(0, splitAt)).trim());
    let prompt = stripModelNotes((splitAt === -1 ? line : line.slice(splitAt + 1)).trim());
    // A bare title, or only a note such as "classic fairy tale", means the image model picks the scene.
    if (!sceneDescription(name, prompt || name)) prompt = name;
    // produce() requires prompt length >= 8
    if (prompt.length < 8) prompt = `${prompt} fairy tale`;
    if (band === '2-3') {
      prompt = `${prompt}. One huge simple shape only, extra-thick outlines, almost no small parts, toddler coloring page`;
    }
    let slug = slugify(name.replace(/coloring page/i, ''));
    if (!slug) continue;
    if (band === '2-3' && !slug.startsWith('huge-')) slug = `huge-${slug}`;
    while (used.has(slug)) slug = `${slug}-2`;
    used.add(slug);
    const title = /coloring page/i.test(name) ? name : `${name} Coloring Page`;
    ideas.push({ slug, title, prompt, difficulty, age: band });
  }
  return ideas;
}

function startJob(label: string, task: () => Promise<void>) {
  if (job.running) throw new Error('Уже выполняется другая задача. Дождитесь окончания.');
  job.running = true;
  job.error = '';
  job.log = [label];
  const originalLog = console.log;
  const originalError = console.error;
  const push = (...args: unknown[]) => {
    const line = args.map((item) => String(item)).join(' ');
    job.log.push(line);
    originalLog(line);
  };
  console.log = push;
  console.error = (...args: unknown[]) => {
    const line = args.map((item) => String(item)).join(' ');
    job.log.push(line);
    originalError(line);
  };
  void task()
    .catch((error: unknown) => {
      job.error = error instanceof Error ? error.message : String(error);
      job.log.push(job.error);
    })
    .finally(() => {
      console.log = originalLog;
      console.error = originalError;
      job.running = false;
      job.log.push(job.error ? 'Остановлено из-за ошибки.' : 'Готово. Обновите сайт в браузере или соберите сайт заново.');
    });
}

async function createPages(body: {
  theme?: string;
  title?: string;
  slug?: string;
  kind?: string;
  ideas?: string;
  age?: string;
}) {
  const age = ageDifficulty[body.age ?? ''] ? String(body.age) : '3-4';
  const ideas = parseIdeas(body.ideas ?? '', age);
  if (!ideas.length) throw new Error('Добавьте хотя бы один рисунок, каждый с новой строки.');
  const themes = await listThemes();
  const existing = themes.find((theme) => theme.slug === body.theme);
  let slug = existing?.slug ?? '';
  let title = existing?.title ?? '';
  let kind = existing?.kind ?? (body.kind === 'seasonal' ? 'seasonal' : 'evergreen');
  let order = 1;
  let accent = '#1D7AD6';
  let ink = '#243038';
  let related: string[] = [];
  let ageBand = age;
  if (!existing) {
    title = (body.title ?? '').trim();
    if (title.length < 3) throw new Error('Напишите название новой подборки.');
    slug = themeSlug((body.slug ?? '').trim() || title);
    if (!slug) throw new Error('Адрес подборки пустой. Напишите латиницей, например valentines-day.');
    if (themes.some((theme) => theme.slug === slug)) throw new Error('Такая подборка уже есть. Выберите её в списке или поправьте адрес.');
    const sameKind = themes.filter((theme) => theme.kind === kind);
    order = sameKind.length + 1;
  } else {
    const data = frontmatter(await fs.readFile(path.join(themeContentRoot, `${slug}.md`), 'utf8'));
    order = Number(data.order ?? 1);
    accent = String(data.accent ?? accent);
    ink = String(data.ink ?? ink);
    ageBand = String(data.ageBand ?? age);
    if (Array.isArray(data.related) && data.related.length) related = data.related.map(String);
  }
  const agesLabel = age.replace('-', ' to ');
  const brief = {
    slug,
    title,
    tagline: `Free ${title.toLowerCase()} for kids ages ${agesLabel}.`,
    description: `Free ${title.toLowerCase()} to print for kids.`,
    kind,
    ageBand,
    order,
    accent,
    ink,
    keywords: [title.toLowerCase()],
    related: (related.length ? related : await suggestRelated(slug, kind)).filter((item) => item !== slug).slice(0, 2),
    audience: `parents of children ages ${agesLabel}`,
    style: drawStyle(age),
    ideas,
    pins: [{ id: 'set', title: `Free ${title}`, subtitle: 'Printable coloring pages' }],
  };
  const cache = path.join(factoryRoot, '.cache');
  await fs.mkdir(cache, { recursive: true });
  const briefPath = path.join(cache, 'studio-brief.yaml');
  await fs.writeFile(briefPath, stringify(brief));
  await fs.mkdir(briefsRoot, { recursive: true });
  startJob(`Новые рисунки: ${ideas.map((idea) => idea.slug).join(', ')}`, async () => {
    await produce(briefPath, false);
    await rewriteThemeBody(slug);
    console.log('Выкладываю PNG и PDF в хранилище. Без этого на сайте будут пустые карточки.');
    try {
      await uploadThemePrints(slug);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`Тексты сайта записаны, в хранилище не вышло: ${message}`);
      console.log('На странице рисования нажмите «Выложить в хранилище».');
    }
  });
}

function drawStyle(age: string) {
  return ageStyle(age);
}

function previewDraw(body: {
  age?: string;
  scene?: string;
  ageCap?: string;
  layout?: string;
  style?: string;
}) {
  const age = String(body.age ?? '5-6');
  const scene = String(body.scene ?? '').trim() || 'one heart with a ribbon';
  const subject = imageSubject('Preview', scene, false, age, body.ageCap !== undefined ? String(body.ageCap) : undefined);
  const style = String(body.style ?? '').trim() || ageStyle(age);
  const prompt = coloringPrompt(style, subject, 'easy', age, body.layout !== undefined ? String(body.layout) : undefined);
  const warning = /dinosaur|динозавр/i.test(prompt) ? 'В этом тексте есть динозавр. Уберите слово, потом сохраните.' : '';
  return { prompt, warning };
}

function send(res: http.ServerResponse, status: number, body: unknown, type = 'application/json') {
  const payload = type === 'application/json' ? JSON.stringify(body) : String(body);
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
  res.end(payload);
}

async function readBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function asDraftSheets(value: unknown): DraftSheet[] {
  if (!Array.isArray(value)) return [];
  return value as DraftSheet[];
}


const BOOK_STYLE =
  'Storybook coloring-page line art. Characters in their story clothes, bold smooth closed black outlines, pure white background, large enclosed coloring areas, clean composition for children ages 4–8. An animal stays that animal, with its ears, muzzle, and tail. No color, gray, shading, gradients, hatching, texture, text, logos, watermark, border, or page number.';

function bookSlug(value: string) {
  return value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55) || 'coloring-book';
}

/** First PNG whose name starts with a zero-padded page prefix (`01-`, `02-`, …), whatever the title slug is. */
function matchPagePng(names: string[], pagePrefix: string): string | undefined {
  const prefix = pagePrefix.toLowerCase();
  return names
    .filter((entry) => entry.toLowerCase().startsWith(prefix) && entry.toLowerCase().endsWith('.png'))
    .sort()[0];
}

async function createBookPlan(body: Record<string, unknown>) {
  const theme = String(body.theme ?? '').trim();
  const age = String(body.age ?? '4-8');
  const count = Math.max(1, Math.min(100, Number(body.count ?? 50) || 50));
  const mode = body.mode === 'tale' ? 'tale' : 'variety';
  if (!theme) throw new Error('Укажите тему книги.');
  if (mode === 'tale') return createTalePlan(theme, age, count);
  const raw = await chat(
    'You are an experienced US children’s coloring-book editor. Return valid JSON only, with exactly the requested number of unique page ideas. Schema: {"ideas":[{"title":"short English title","prompt":"clear visual scene description in English","difficulty":"easy|medium|detailed"}]}. Make age-appropriate, commercially appealing variety for parents of children. No text inside illustrations, no trademarked characters, no near-duplicates. Each prompt must describe one distinct printable coloring page.',
    `Create exactly ${count} distinct coloring-page ideas for a children’s coloring book ages ${age}. Theme: ${theme}. If the theme is religious, treat it respectfully and use recognizable traditional scenes. If seasonal, mix activities, objects, animals, and family scenes as appropriate. Use simple friendly scenes, clear large coloring areas, and avoid invented factual claims. Return exactly ${count} ideas.`
  );
  let parsed: { ideas?: { title?: string; prompt?: string; difficulty?: string }[] };
  try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|```$/g, '').trim()); }
  catch { throw new Error('Текстовая модель вернула план не в формате JSON. Нажмите «Создать план» ещё раз.'); }
  let ideas = Array.isArray(parsed.ideas) ? parsed.ideas : [];
  ideas = ideas.filter((x) => x && String(x.title ?? '').trim() && String(x.prompt ?? '').trim());
  if (ideas.length > count) ideas = ideas.slice(0, count);
  if (ideas.length < count) {
    const missing = count - ideas.length;
    const extraRaw = await chat(
      'Return valid JSON only: {"ideas":[{"title":"short English title","prompt":"clear visual scene description in English","difficulty":"easy|medium|detailed"}]}. Make each idea unique from the existing list.',
      `Create exactly ${missing} additional distinct coloring-page ideas for theme ${theme}, ages ${age}. Existing titles to avoid: ${ideas.map((x) => x.title).join('; ')}. Return exactly ${missing} ideas.`
    );
    try {
      const extra = JSON.parse(extraRaw.replace(/^```(?:json)?\s*|```$/g, '').trim()) as {ideas?: typeof ideas};
      if (Array.isArray(extra.ideas)) ideas.push(...extra.ideas.filter((x) => x?.title && x?.prompt));
    } catch { /* exact-count fallback below */ }
  }
  ideas = ideas.slice(0, count);
  while (ideas.length < count) {
    const n = ideas.length + 1;
    ideas.push({ title: `${theme} Coloring Scene ${n}`, prompt: `A simple, original child-friendly scene related to ${theme}, with one clear focal subject and large enclosed areas for coloring`, difficulty: 'easy' });
  }
  return { mode: 'variety' as const, theme, age, count, ideas: ideas.map((x, i) => ({
    title: String(x.title).trim().slice(0, 100),
    prompt: String(x.prompt).trim().slice(0, 1200),
    difficulty: (['easy', 'medium', 'detailed'].includes(String(x.difficulty)) ? String(x.difficulty) : (age === '4-8' ? 'medium' : 'easy')) as LineDifficulty,
    index: i + 1,
  })) };
}

// ---------- Выпуск пинов: сжатие → хранилище R2 → очередь → таблица ----------

type RunOptions = { cwd?: string; env?: NodeJS.ProcessEnv; onLine?: (line: string) => void };

function runProgram(
  cmd: string,
  args: string[],
  options: RunOptions = {},
): Promise<{ code: number; lines: string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: options.cwd, env: options.env ?? process.env, windowsHide: true });
    const lines: string[] = [];
    const push = (line: string) => {
      if (!line.trim()) return;
      lines.push(line);
      options.onLine?.(line);
    };
    let outRest = '';
    let errRest = '';
    const feed = (rest: string, chunk: string) => {
      const parts = (rest + chunk).split(/\r\n|\n|\r/);
      const tail = parts.pop() ?? '';
      parts.forEach(push);
      return tail;
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      outRest = feed(outRest, chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      errRest = feed(errRest, chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      push(outRest);
      push(errRest);
      resolve({ code: code ?? 1, lines });
    });
  });
}

async function findRclone(): Promise<string> {
  const candidates = [
    process.env.RCLONE_PATH,
    'rclone',
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'rclone.exe')
      : '',
  ].filter(Boolean) as string[];
  for (const cmd of candidates) {
    try {
      const result = await runProgram(cmd, ['version']);
      if (result.code === 0) return cmd;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    'Не нашла программу rclone, которая загружает файлы в хранилище. Закройте фабрику, перезагрузите компьютер (так Windows увидит rclone) и запустите снова. Если не поможет, напишите мне.',
  );
}

async function compressNewPins() {
  const names = (await fs.readdir(pinRoot)).filter((name) => /\.png$/i.test(name));
  let made = 0;
  for (const name of names) {
    const png = path.join(pinRoot, name);
    const jpg = png.replace(/\.png$/i, '.jpg');
    const pngStat = await fs.stat(png);
    try {
      const jpgStat = await fs.stat(jpg);
      if (jpgStat.mtimeMs >= pngStat.mtimeMs) continue;
    } catch {
      // no JPG yet
    }
    await sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toFile(jpg);
    made++;
  }
  return { total: names.length, made };
}

async function uploadToStorage(rclone: string, label: string, source: string, folder: string, extra: string[] = []) {
  const remote = process.env.R2_REMOTE || 'r2';
  const bucket = process.env.R2_BUCKET || 'sfl-files';
  console.log(`Загружаю: ${label}…`);
  let copied = 0;
  const result = await runProgram(rclone, ['copy', source, `${remote}:${bucket}/${folder}`, ...extra, '-v'], {
    onLine: (line) => {
      if (/: Copied \(/.test(line)) copied++;
      else if (/ERROR|Failed|NOTICE/.test(line)) console.log(line);
    },
  });
  if (result.code !== 0) {
    throw new Error(`Загрузка «${label}» не удалась (rclone вернул код ${result.code}). Ошибки выше в логе.`);
  }
  console.log(
    copied
      ? `${label}: загружено или обновлено файлов — ${copied}.`
      : `${label}: всё уже в хранилище, новых файлов нет.`,
  );
}

async function uploadThemePrints(theme: string) {
  const rclone = await findRclone();
  const source = theme ? path.join(printRoot, theme) : printRoot;
  const folder = theme ? `print/${theme}` : 'print';
  await uploadToStorage(rclone, theme ? `картинки ${theme}` : 'листы для скачивания', source, folder);
}

type QueueRow = Record<string, string>;

async function buildMakeQueue(theme?: string): Promise<QueueRow[]> {
  const script = path.join(factoryRoot, 'scripts', 'build-make-queue.mjs');
  const outDir = path.join(factoryRoot, 'out', 'pinterest');
  const result = await runProgram(process.execPath, [script], {
    cwd: factoryRoot,
    env: {
      ...process.env,
      PIN_ROOT: pinRoot,
      OUT_DIR: outDir,
      ...(theme ? { PIN_THEME: theme } : {}),
    },
  });
  if (result.code !== 0) {
    throw new Error(`Не удалось собрать очередь: ${result.lines.slice(-3).join(' ')}`);
  }
  const wrote = result.lines.findIndex((line) => line.startsWith('Wrote '));
  if (wrote >= 0) for (const line of result.lines.slice(wrote + 1)) console.log(line);
  return JSON.parse(await fs.readFile(path.join(outDir, 'make-queue.json'), 'utf8')) as QueueRow[];
}

async function sendRowsToSheet(rows: QueueRow[]) {
  const url = (process.env.SHEET_WEBHOOK_URL ?? '').trim();
  const token = (process.env.SHEET_WEBHOOK_TOKEN ?? '').trim();
  if (!url) {
    console.log(
      'Таблица пока не подключена: в файле .env нет SHEET_WEBHOOK_URL. Очередь лежит в factory\\out\\pinterest\\make-queue.csv.',
    );
    return;
  }
  let added = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token, rows: rows.slice(i, i + 100) }),
      redirect: 'follow',
    });
    const text = await response.text();
    let data: { ok?: boolean; added?: number; skipped?: number; error?: string };
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Таблица ответила не так, как ожидалось: ${text.slice(0, 200)}`);
    }
    if (!data.ok) throw new Error(`Таблица отказала: ${data.error ?? 'неизвестная ошибка'}`);
    added += data.added ?? 0;
    skipped += data.skipped ?? 0;
    await rememberShippedPins(rows.slice(i, i + 100).map((row) => row.filename));
  }
  console.log(`Таблица: добавлено новых строк — ${added}, уже были — ${skipped}.`);
}

async function publishPins(theme?: string) {
  const themeKey = themeKeyFromSlug(String(theme ?? ''));
  const copyTheme = themeKey ? `${themeKey}-coloring-pages` : undefined;
  const rclone = await findRclone();
  const label = themeKey || 'все темы';
  console.log(`Тема для таблицы: ${label}.`);
  console.log(
    copyTheme
      ? `Дописываю пустые тексты пинов «${copyTheme}» — без названия и описания строка в таблицу не идёт.`
      : 'Дописываю пустые тексты пинов у всех тем — без названия и описания строка в таблицу не идёт.',
  );
  const copy = await writePinCopyOnly({ theme: copyTheme, overwrite: false });
  console.log(
    copy.updated
      ? `Написано текстов: ${copy.updated}.`
      : 'Пустых текстов нет — либо уже написаны, либо нет картинок.',
  );
  console.log('Шаг 1 из 4. Сжимаю новые пины в JPG…');
  const compressed = await compressNewPins();
  console.log(
    compressed.made ? `Сжато новых или обновлённых пинов: ${compressed.made}.` : 'Новых пинов для сжатия нет.',
  );
  console.log('Шаг 2 из 4. Загружаю в хранилище…');
  const blockedJpg = [...(await readQueueBlock())].map((name) => name.replace(/\.png$/i, '.jpg'));
  await uploadToStorage(rclone, 'пины', pinRoot, 'pins', [
    ...blockedJpg.flatMap((name) => ['--exclude', name]),
    '--include',
    '/*.jpg',
  ]);
  await uploadToStorage(rclone, 'листы для скачивания', printRoot, 'print');
  console.log('Шаг 3 из 4. Собираю очередь для Pinterest…');
  const rows = await buildMakeQueue(themeKey || undefined);
  console.log(`В очереди пинов: ${rows.length}.`);
  if (!rows.length) {
    console.log(
      'В очередь никто не попал. Часто причина: нет JPG, нет текста или пины уже лежат в pins/done.',
    );
    return;
  }
  console.log('Шаг 4 из 4. Отправляю новые строки в таблицу…');
  await sendRowsToSheet(rows);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, await fs.readFile(uiPath, 'utf8'), 'text/html');
    }
    if (req.method === 'GET' && url.pathname === '/api/book/styles') {
      const files = (await fs.readdir(briefsRoot)).filter((name) => name.endsWith('.yaml'));
      const styles = [];
      for (const file of files) {
        try {
          const data = parse(await fs.readFile(path.join(briefsRoot, file), 'utf8')) as Record<string, unknown>;
          if (typeof data.style === 'string' && data.style.trim()) styles.push({ slug: file.replace(/\.yaml$/, ''), title: String(data.title ?? file.replace(/\.yaml$/, '')), style: data.style });
        } catch { /* skip invalid brief */ }
      }
      styles.sort((a, b) => a.title.localeCompare(b.title));
      return send(res, 200, styles);
    }
    if (req.method === 'POST' && url.pathname === '/api/book/parse') {
      const body = await readBody(req);
      const age = String(body.age ?? '4-8');
      const ideas = parseStoryboard(String(body.text ?? ''), age);
      if (!ideas.length) throw new Error('В тексте нет таблицы сцен. Нужны строки вида | номер | название | описание | сложность |.');
      return send(res, 200, { source: 'Вставленная раскадровка', count: ideas.length, ideas });
    }
    if (req.method === 'POST' && url.pathname === '/api/book/plan') {
      const body = await readBody(req);
      const plan = await createBookPlan(body);
      return send(res, 200, plan);
    }
    if (req.method === 'POST' && url.pathname === '/api/book/cast') {
      const body = await readBody(req);
      const title = String(body.title ?? body.theme ?? 'Coloring Book').trim();
      const age = String(body.age ?? '4-8');
      const style = String(body.style ?? '').trim() || BOOK_STYLE;
      const characters = normalizeCharacters(body.characters);
      const redrawId = String(body.redrawId ?? '').trim();
      if (!characters.length) throw new Error('В плане нет строк героев. Сначала создайте план сказки или допишите строки # character.');
      const castDir = path.join(factoryRoot, 'out', 'books', bookSlug(title), 'cast');
      startJob(redrawId ? `Герой «${redrawId}»` : `Герои книги «${title}»`, async () => {
        if (redrawId) await redrawTaleCast(castDir, characters, redrawId, style, age);
        else await ensureTaleCast(castDir, characters, style, age);
        console.log(`Образцы: ${castDir}`);
        console.log('Страницы не рисовались. Откройте папку, поправьте текст героя в плане и перерисуйте только его, если лицо не то.');
      });
      return send(res, 202, { ok: true, folder: castDir });
    }
    if (req.method === 'POST' && url.pathname === '/api/book/generate') {
      const body = await readBody(req);
      const title = String(body.title ?? body.theme ?? 'Coloring Book').trim();
      const theme = String(body.theme ?? title).trim();
      const age = String(body.age ?? '4-8');
      let style = String(body.style ?? '').trim() || BOOK_STYLE;
      // Reuse the factory's selected style, removing only rules that contradict this book's subject or the established face style.
      if (/christmas|nativity|jesus|manger/i.test(`${theme} ${title}`)) {
        style = style.replace(/\bnot a nativity scene\.?/gi, '');
      }
      style = style.replace(/\bEyes are open circles,? never solid black\.?/gi, 'Eyes should have small solid black pupils and simple friendly highlights, matching the factory’s usual coloring-page style.');
      const ideas = Array.isArray(body.ideas) ? body.ideas as {title?: string; prompt?: string; difficulty?: string; index?: number; cast?: string[]}[] : [];
      if (!ideas.length) throw new Error('Сначала создайте план книги.');
      const taleMode = body.mode === 'tale';
      const safeTitle = bookSlug(title);
      const outDir = path.join(factoryRoot, 'out', 'books', safeTitle, 'images');
      const castDir = path.join(outDir, '..', 'cast');
      const characters = taleMode ? normalizeCharacters(body.characters) : [];
      if (characters.length) {
        const known = new Set(characters.map((person) => person.id));
        const needed = new Set<string>();
        for (const idea of ideas) {
          const listed = Array.isArray(idea.cast) ? idea.cast : [];
          for (const id of listed) if (known.has(String(id).trim())) needed.add(String(id).trim());
        }
        const missing = await missingTaleCast(castDir, [...needed]);
        if (missing.length) {
          throw new Error(`Нет образцов: ${missing.join(', ')}. Нажмите «Нарисовать героев» и проверьте папку cast. Страницы не рисовались.`);
        }
      }
      startJob(`Книга «${title}»: генерация ${ideas.length} страниц`, async () => {
        await fs.mkdir(outDir, { recursive: true });
        let toldSoften = false;
        for (const [position, idea] of ideas.entries()) {
          const index = Number.isInteger(Number(idea.index)) ? Number(idea.index) : position;
          const name = String(idea.title ?? `Page ${index + 1}`).trim();
          const pagePrefix = `${String(index + 1).padStart(2, '0')}-`;
          const slug = bookSlug(`${pagePrefix}${name}`);
          const file = path.join(outDir, `${slug}.png`);
          // A full book skips any PNG already saved for this page number, even when the title slug changed.
          // One idea is a single page or "replace this scene" and must overwrite.
          if (ideas.length > 1) {
            let existingName: string | undefined;
            try {
              existingName = matchPagePng(await fs.readdir(outDir), pagePrefix);
            } catch {
              existingName = undefined;
            }
            if (existingName) {
              console.log(`Пропуск ${index + 1}/${ideas.length}: ${name} — файл уже есть: ${existingName}`);
              continue;
            }
          }
          console.log(`Генерация ${index + 1}/${ideas.length}: ${name}`);
          const original = String(idea.prompt ?? name);
          const known = new Set(characters.map((person) => person.id));
          const castIds = (Array.isArray(idea.cast) ? idea.cast.map((id) => String(id).trim()).filter((id) => known.has(id)) : []);
          const references = castIds.length ? await loadTaleCast(castDir, castIds) : [];
          if (castIds.length) console.log(`Образцы для этого кадра: ${castIds.join(', ')}`);
          const sceneFor = (levelName: 'names' | 'tale' | 'retry') => {
            const softened = softenTaleSubject(original, taleMode && levelName === 'names' ? 'tale' : levelName);
            return taleMode ? `${referenceNote(castIds, characters)} One specific moment: ${softened}` : softened;
          };
          const subject = sceneFor(taleMode ? 'tale' : 'names');
          if (!toldSoften && subject !== original) {
            toldSoften = true;
            console.log('Описание для картинки смягчено: фильтр OpenAI отклоняет знаменитое имя и сцену с ребёнком в лохмотьях.');
          }
          const level = (['easy','medium','detailed'].includes(String(idea.difficulty)) ? String(idea.difficulty) : 'medium') as LineDifficulty;
          const draw = async (scene: string) => generateColoringPage(coloringPrompt(style, scene, level, age), references, taleMode ? TALE_IMAGE_MODEL : undefined);
          let raw: Buffer;
          try {
            raw = await draw(subject);
          } catch (error) {
            if (!isSafetyRejection(error)) throw error;
            console.log(`Фильтр OpenAI отклонил «${name}». Повторяю ту же сцену нейтральными словами.`);
            try {
              raw = await draw(sceneFor('retry'));
            } catch (again) {
              if (!isSafetyRejection(again)) throw again;
              throw new Error(`OpenAI отклонил страницу «${name}»: фильтр видит ребёнка в беде или чужое имя. Перепишите середину строки как спокойную сцену со взрослой героиней в простом чистом платье, без знаменитого имени, лохмотьев и слёз, и запустите эту страницу ещё раз.`);
            }
          }
          const print = await fitPortrait(raw);
          await fs.writeFile(file, print);
          console.log(`Сохранено: ${file}`);
        }
        console.log(`Готово. Папка изображений: ${outDir}`);
        console.log('Следующий шаг: вкладка Amazon KDP → укажите эту папку → «Открыть папку» → «Собрать PDF для KDP».');
      });
      return send(res, 202, { ok: true, folder: outDir, count: ideas.length });
    }
    if (req.method === 'GET' && url.pathname === '/api/themes') return send(res, 200, await listThemes());
    if (req.method === 'GET' && url.pathname === '/api/site/sheets') {
      const theme = url.searchParams.get('theme') ?? '';
      if (!theme) return send(res, 200, { sheets: [] });
      return send(res, 200, { sheets: await listThemeSheets(theme) });
    }
    if (req.method === 'POST' && url.pathname === '/api/site/replace-image') {
      const body = await readBody(req);
      const theme = String(body.theme ?? '').trim();
      const slug = String(body.slug ?? '').trim();
      const dataUrl = String(body.dataUrl ?? '');
      const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!theme || !slug || !match) throw new Error('Выберите подборку, лист и файл PNG/JPG/WebP.');
      const sheets = await listThemeSheets(theme);
      const sheet = sheets.find((item) => item.slug === slug);
      if (!sheet) throw new Error('Лист не найден в выбранной подборке.');
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const tempDir = path.join(factoryRoot, '.cache', 'site-image-replacement');
      await fs.mkdir(tempDir, { recursive: true });
      const tempFile = path.join(tempDir, `${Date.now()}-${slug}.${ext}`);
      const image = Buffer.from(match[2], 'base64');
      if (image.length > 20 * 1024 * 1024) throw new Error('Файл больше 20 МБ.');
      try {
        await fs.writeFile(tempFile, image);
        startJob(`Замена готового рисунка: ${theme}/${slug}`, async () => {
          try {
            await publishPrintAssets(theme, { file: tempFile, slug: sheet.slug, title: sheet.title });
            console.log(`Готово: заменены preview PNG, US Letter PDF и A4 PDF для ${theme}/${slug}. Описание и метаданные сайта не менялись.`);
            console.log('Выкладываю заменённые файлы в хранилище.');
            try {
              await uploadThemePrints(theme);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              console.log(`На диске заменено, в хранилище не вышло: ${message}`);
              console.log('На странице рисования нажмите «Выложить в хранилище».');
            }
          } finally {
            await fs.rm(tempFile, { force: true });
          }
        });
      } catch (error) {
        await fs.rm(tempFile, { force: true });
        throw error;
      }
      return send(res, 202, { ok: true, theme, slug });
    }
    if (req.method === 'GET' && url.pathname === '/api/job') {
      return send(res, 200, {
        running: job.running,
        log: job.log,
        error: job.error,
        drafts: job.drafts,
        kdpPages: job.kdpPages,
        lastTheme: job.lastTheme,
        lastKdpPageCount: job.lastKdpPageCount,
        folder: job.folder,
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/site/preview') {
      const theme = url.searchParams.get('theme') ?? '';
      const slug = url.searchParams.get('slug') ?? '';
      if (!/^[a-z0-9-]+$/.test(theme) || !/^[a-z0-9-]+$/.test(slug)) {
        return send(res, 404, { error: 'Нет превью' });
      }
      const file = path.join(printRoot, theme, `${slug}.png`);
      try {
        const bytes = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        res.end(bytes);
        return;
      } catch {
        return send(res, 404, { error: 'Нет превью' });
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/import/thumb') {
      const id = url.searchParams.get('id') ?? '';
      if (!/^imp-[\w-]+$/.test(id)) return send(res, 404, { error: 'Нет превью' });
      const file = path.join(factoryRoot, '.cache', 'import-thumbs', `${id}.jpg`);
      try {
        const bytes = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
        res.end(bytes);
        return;
      } catch {
        return send(res, 404, { error: 'Нет превью' });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/import/scan') {
      const body = await readBody(req);
      const folder = String(body.folder ?? '').trim();
      if (!folder) throw new Error('Укажите папку с картинками.');
      job.folder = folder;
      let sheets = await scanImportFolder(folder);
      const theme = String(body.theme ?? '').trim();
      if (theme && theme !== '__new__') job.lastTheme = theme;
      let matched = 0;
      let siteSheets: { slug: string; title: string; age: string }[] = [];
      if (theme && theme !== '__new__') {
        const imagesOnly = Boolean(body.imagesOnly);
        console.log(`Открыл папку, сопоставляю с ${theme}${imagesOnly ? ' (только картинки)' : ''}…`);
        const result = await matchDraftsToTheme(theme, sheets, { imagesOnly });
        sheets = result.drafts;
        matched = result.matched;
        siteSheets = result.siteSheets.map((sheet) => ({
          slug: sheet.slug,
          title: sheet.title,
          age: sheet.age,
        }));
      }
      job.drafts = sheets;
      void saveSession();
      return send(res, 200, { sheets, matched, siteSheets });
    }
    if (req.method === 'POST' && url.pathname === '/api/import/restore') {
      const body = await readBody(req);
      const sheets = asDraftSheets(body.sheets ?? body.drafts);
      if (!sheets.length) throw new Error('Пустой список — в окне больше нет карточек импорта.');
      job.drafts = sheets;
      await saveSession();
      console.log(`Восстановлено из окна браузера: ${sheets.length} листов. Сессия сохранена.`);
      return send(res, 200, { ok: true, count: sheets.length, sheets });
    }
    if (req.method === 'POST' && url.pathname === '/api/import/name') {
      const body = await readBody(req);
      const sheets = asDraftSheets(body.sheets);
      if (!sheets.length) throw new Error('Нет листов для именования.');
      startJob(`Называю по картинке: ${sheets.length}`, async () => {
        const named: DraftSheet[] = [];
        for (const [index, sheet] of sheets.entries()) {
          console.log(`vision ${index + 1}/${sheets.length}: ${path.basename(sheet.file)}`);
          try {
            const next = await nameDraftWithVision(sheet);
            named.push(next);
            console.log(`  → ${next.slug} · ${next.title}`);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.log(`не назвался: ${message}`);
            named.push(sheet);
          }
        }
        const byId = new Map(named.map((sheet) => [sheet.id, sheet]));
        job.drafts = (job.drafts ?? sheets).map((sheet) => byId.get(sheet.id) ?? sheet);
        await saveSession();
        console.log('Названия обновлены. Можно нажать «Записать на сайт».');
      });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/kdp/scan') {
      const body = await readBody(req);
      const folder = String(body.folder ?? '').trim();
      if (!folder) throw new Error('Укажите папку с SVG/PNG.');
      const pages = await listKdpPages(folder);
      const prev = new Map(
        (job.kdpPages ?? []).map((page) => [path.resolve(page.file).toLowerCase(), page.caption.trim()]),
      );
      job.kdpPages = pages.map((page) => {
        const old = prev.get(path.resolve(page.file).toLowerCase());
        return old ? { ...page, caption: old } : page;
      });
      void saveSession();
      return send(res, 200, { pages: job.kdpPages });
    }
    if (req.method === 'POST' && url.pathname === '/api/kdp/name') {
      const body = await readBody(req);
      const pages = Array.isArray(body.pages) ? (body.pages as KdpPage[]) : [];
      if (!pages.length) throw new Error('Сначала откройте папку KDP.');
      startJob(`KDP: называю рисунки (${pages.length})`, async () => {
        const named: KdpPage[] = [];
        for (const [index, page] of pages.entries()) {
          console.log(`vision ${index + 1}/${pages.length}: ${path.basename(page.file)}`);
          try {
            named.push(await nameKdpPage(page));
            console.log(`  → ${named[named.length - 1].caption}`);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.log(`не назвался: ${message}`);
            named.push(page);
          }
        }
        job.kdpPages = named;
        await saveSession();
        console.log('Подписи готовы и сохранены. Проверьте список и нажмите «Собрать PDF для KDP».');
      });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/kdp/from-import') {
      const body = await readBody(req);
      const pages =
        (Array.isArray(body.pages) ? (body.pages as KdpPage[]) : null) ?? job.kdpPages ?? [];
      const drafts =
        (Array.isArray(body.drafts) ? (body.drafts as DraftSheet[]) : null) ?? job.drafts ?? [];
      if (!pages.length) throw new Error('Сначала на вкладке Amazon KDP нажмите «Открыть папку».');
      if (!drafts.length) {
        throw new Error(
          'Нет сохранённых названий из импорта. Откройте папку на вкладке импорта или назовите заново в KDP.',
        );
      }
      const { pages: next, applied } = applyImportCaptions(pages, drafts);
      job.kdpPages = next;
      void saveSession();
      return send(res, 200, { pages: next, applied, total: pages.length });
    }
    if (req.method === 'POST' && url.pathname === '/api/kdp') {
      const body = await readBody(req);
      const folder = String(body.folder ?? '').trim();
      const title = String(body.title ?? '').trim();
      if (!folder) throw new Error('Укажите папку с SVG/PNG.');
      if (!title) throw new Error('Напишите название книги.');
      const pages = Array.isArray(body.pages) ? (body.pages as KdpPage[]) : undefined;
      const blankBacks = body.blankBacks !== false;
      const padEvenPages =
        body.padEvenPages !== undefined ? Boolean(body.padEvenPages) : blankBacks;
      const frontCover = body.frontCover ? String(body.frontCover).trim() : '';
      const backCover = body.backCover ? String(body.backCover).trim() : '';
      const download = Boolean(body.download) || Boolean(frontCover || backCover) || blankBacks === false;
      // Always force light JPEG for digital/download builds (covers alone used to balloon past 100 MB).
      const encodePreset = download || blankBacks === false ? 'download' : undefined;
      startJob(download ? `PDF скачивание: ${title}` : `KDP книга: ${title}`, async () => {
        const result = await buildKdpBook({
          folder,
          title,
          subtitle: body.subtitle ? String(body.subtitle) : undefined,
          author: body.author ? String(body.author) : undefined,
          copyright: body.copyright ? String(body.copyright) : undefined,
          outFile: body.outFile ? String(body.outFile) : undefined,
          blankBacks,
          frontMatter: body.frontMatter !== false,
          captions: body.captions !== false,
          padEvenPages,
          frontCover: frontCover || undefined,
          backCover: backCover || undefined,
          encodePreset,
          pages,
        });
        job.lastKdpPageCount = result.pages;
        await saveSession();
        console.log(result.outFile);
        if (download && !blankBacks) {
          console.log(
            `Готово для продажи как digital download: ${result.pages} стр. (рисунков: ${result.artPages}).`,
          );
        } else {
          console.log(`Открой файл и загрузи в KDP как Interior.`);
          console.log(
            `Страниц в PDF: ${result.pages} (рисунков: ${result.artPages}).` +
              ` В Amazon и в шаблон обложки вводи ${result.pages} — считают каждую сторону листа, не «листы пополам».`,
          );
        }
      });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/kdp/audit') {
      const body = await readBody(req);
      const folder = String(body.folder ?? '').trim();
      if (!folder) throw new Error('Укажите папку с SVG/PNG.');
      const pages = Array.isArray(body.pages) ? (body.pages as KdpPage[]) : undefined;
      const redraw = Boolean(body.redraw);
      const resumeDir = body.resumeDir ? String(body.resumeDir).trim() : undefined;
      const overridesDir = body.overridesDir ? String(body.overridesDir).trim() : undefined;
      const select = body.select ? String(body.select).trim() : undefined;
      const extraFolder = body.extraFolder ? String(body.extraFolder).trim() : undefined;
      const overwrite = Boolean(body.overwrite);
      const label = select || extraFolder
        ? 'KDP: ручная перерисовка'
        : resumeDir && redraw
          ? 'KDP: дорисовываю / проверяю с заменами'
          : redraw
            ? 'KDP: аудит + перерисовка'
            : 'KDP: аудит стиля';
      startJob(label, async () => {
        const report = await auditKdpFolder({
          folder,
          pages,
          redraw: redraw || Boolean(resumeDir) || Boolean(select) || Boolean(extraFolder),
          age: body.age ? String(body.age) : '3-4',
          styleHint: body.styleHint ? String(body.styleHint) : undefined,
          resumeDir,
          overridesDir: overridesDir || resumeDir,
          select,
          extraFolder,
          overwrite,
        });
        console.log(
          report.flagged.length
            ? `Готово: заменить/проверить номера ${report.flagged.map((row) => row.index).join(', ')}.`
            : 'Готово: все страницы примерно одного уровня.',
        );
      });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/kdp/cover') {
      const body = await readBody(req);
      const title = String(body.title ?? '').trim() || 'Coloring Book';
      let pageCount = Number(body.pageCount ?? 0);
      if (!pageCount || pageCount < 24) {
        const artCount =
          Number(body.artCount ?? 0) ||
          (Array.isArray(body.pages) ? body.pages.length : 0) ||
          job.kdpPages?.length ||
          0;
        pageCount =
          job.lastKdpPageCount ||
          estimateInteriorPages({
            artCount,
            blankBacks: body.blankBacks !== false,
            frontMatter: body.frontMatter !== false,
          });
      }
      startJob(`KDP обложка: ${pageCount} стр.`, async () => {
        const result = await buildKdpCoverTemplate({
          pageCount,
          title,
          slots: body.slots ? Number(body.slots) : 4,
          outFile: body.outFile ? String(body.outFile) : undefined,
        });
        job.lastKdpPageCount = result.pages;
        await saveSession();
        console.log(result.outFile);
      });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/kdp/download-from-pdf') {
      const body = await readBody(req);
      const pdfFile = String(body.pdfFile ?? '').trim();
      if (!pdfFile) throw new Error('Укажите путь к готовому KDP PDF.');
      const frontCover = body.frontCover ? String(body.frontCover).trim() : '';
      const backCover = body.backCover ? String(body.backCover).trim() : '';
      const outFile = body.outFile ? String(body.outFile).trim() : undefined;
      startJob('KDP PDF → скачивание', async () => {
        const result = await buildDownloadPdfFromKdp({
          pdfFile,
          frontCover: frontCover || undefined,
          backCover: backCover || undefined,
          outFile,
        });
        job.lastKdpPageCount = result.pagesOut;
        await saveSession();
        const outMb = (result.sizeOut / (1024 * 1024)).toFixed(1);
        const inMb = (result.sizeIn / (1024 * 1024)).toFixed(1);
        console.log(
          `Готово для digital download: было ${result.pagesIn}, осталось ${result.kept}, ` +
            `убрано пустых ${result.removed}, сжато ${result.rebuilt}, как есть ${result.copied}, ` +
            `в файле ${result.pagesOut} стр. (${inMb} → ${outMb} MB)`,
        );
      });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/kdp/reorder') {
      const body = await readBody(req);
      const pdfFile = String(body.pdfFile ?? '').trim();
      if (!pdfFile) throw new Error('Укажите путь к готовому PDF.');
      const mode = String(body.mode ?? 'swap');
      const withBacks = body.withBacks !== false;
      const outFile = body.outFile ? String(body.outFile).trim() : undefined;
      startJob('KDP: меняю порядок страниц', async () => {
        if (mode === 'order') {
          const order = String(body.order ?? '')
            .split(/[,;\s]+/)
            .map((n) => Number(n.trim()))
            .filter((n) => Number.isFinite(n));
          const result = await reorderKdpPdf({ pdfFile, order, outFile });
          console.log(`Готово: ${result.pages} стр. → ${result.outFile}`);
          return;
        }
        if (mode === 'move') {
          const from = Number(body.from);
          const to = Number(body.to);
          const result = await reorderKdpPdf({ pdfFile, move: { from, to }, outFile });
          console.log(`Готово: стр. ${from} → позиция ${to}. ${result.outFile}`);
          return;
        }
        const a = Number(body.a);
        const b = Number(body.b);
        const result = await reorderKdpPdf({
          pdfFile,
          swap: [a, b],
          withBacks,
          outFile,
        });
        console.log(
          `Готово: поменяла ${a}↔${b}${withBacks ? ' (+ обороты)' : ''}. ${result.outFile}`,
        );
      });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/import/commit') {
      const body = await readBody(req);
      const sheets = asDraftSheets(body.sheets);
      const imagesOnly = Boolean(body.imagesOnly);
      startJob(imagesOnly ? 'Обновляю только картинки' : 'Импорт стока на сайт', async () => {
        const result = await commitImport({
          theme: String(body.theme ?? ''),
          title: body.title ? String(body.title) : undefined,
          slug: body.slug ? String(body.slug) : undefined,
          kind: body.kind === 'seasonal' ? 'seasonal' : 'evergreen',
          ageBand: (String(body.ageBand ?? '3-4') as AgeBand) || '3-4',
          sheets,
          imagesOnly,
        });
        job.lastTheme = result.theme;
        if (imagesOnly) {
          console.log(`Готово: обновлены картинки у ${result.published.length} листов в ${result.theme}. Тексты страниц не трогала.`);
        } else {
          console.log(
            `Готово: ${result.published.length} листов в ${result.theme}. Описание подборки, возраст и FAQ переписаны по текущим листам.`,
          );
        }
        console.log('Выкладываю PNG/PDF в интернет. Без этого на сайте будут пустые карточки.');
        try {
          const rclone = await findRclone();
          await uploadToStorage(
            rclone,
            `картинки ${result.theme}`,
            path.join(printRoot, result.theme),
            `print/${result.theme}`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`На диск записала, в интернет не вышло: ${message}`);
          console.log('Нажмите «Выложить картинки в интернет».');
        }
      });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/print/upload') {
      const body = await readBody(req);
      const theme = String(body.theme ?? '').trim();
      if (!theme || theme === '__new__') throw new Error('Выберите подборку.');
      startJob(`Выкладываю картинки: ${theme}`, async () => {
        const rclone = await findRclone();
        await uploadToStorage(
          rclone,
          `картинки ${theme}`,
          path.join(printRoot, theme),
          `print/${theme}`,
        );
      });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/theme/ages') {
      const body = await readBody(req);
      const theme = String(body.theme ?? '').trim();
      const age = String(body.age ?? '').trim();
      if (!theme || theme === '__new__') throw new Error('Выберите подборку на сайте.');
      if (!AGE_BANDS.includes(age as AgeBand)) throw new Error('Выберите возраст.');
      const all = body.all === true;
      const listed = Array.isArray(body.slugs) ? body.slugs.map(String) : [];
      const slugs = all ? (await listThemeSheets(theme)).map((sheet) => sheet.slug) : listed;
      const result = await setSheetAges(theme, slugs, age as AgeBand);
      const missed = result.missing.length ? ` Не найдены: ${result.missing.join(', ')}.` : '';
      console.log(
        result.updated
          ? `Возраст ${age} записан у ${result.updated} лист(ов) в ${theme}. Картинки не менялись.${missed}`
          : `В ${theme} этот возраст уже стоял.${missed}`,
      );
      return send(res, 200, { ok: true, ...result });
    }
    if (req.method === 'POST' && url.pathname === '/api/theme/rewrite') {
      const body = await readBody(req);
      const theme = String(body.theme ?? '').trim();
      if (!theme || theme === '__new__') throw new Error('Выберите подборку на сайте.');
      startJob(`Текст подборки: ${theme}`, async () => {
        await rewriteThemeBody(theme);
        job.lastTheme = theme;
      });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/pins/sheets') {
      const theme = url.searchParams.get('theme') ?? '';
      if (!theme) throw new Error('Укажите тему.');
      return send(res, 200, { sheets: await listPinSheets(theme) });
    }
    if (req.method === 'GET' && url.pathname === '/api/pins/list') {
      const theme = url.searchParams.get('theme') ?? '';
      if (!theme) throw new Error('Укажите тему.');
      return send(res, 200, { pins: await listThemePins(theme) });
    }
    if (req.method === 'POST' && url.pathname === '/api/pins/copy') {
      const body = await readBody(req);
      const theme = body.theme ? String(body.theme) : undefined;
      const mode = (['collection', 'single', 'both'].includes(String(body.mode))
        ? String(body.mode)
        : 'both') as PinMode;
      const filenames = Array.isArray(body.filenames) ? body.filenames.map(String) : undefined;
      const overwrite = Boolean(body.overwrite);
      const keywords = body.keywords ? String(body.keywords) : '';
      const label = [
        theme ? `Тексты пинов ${theme}` : 'Тексты пинов всех подборок',
        mode === 'collection' ? 'только бандлы' : mode === 'single' ? 'только одиночные' : 'все типы',
        overwrite ? 'перезапись' : 'только пустые',
        'без перерисовки картинок',
      ].join(', ');
      startJob(label, async () => {
        const result = await writePinCopyOnly({ theme, mode, filenames, overwrite, keywords });
        console.log(
          result.updated
            ? `Готово: обновлены тексты у ${result.updated} пин(ов) в pins.csv. PNG не трогали.`
            : 'Готово: менять нечего (уже есть текст или нет картинок).',
        );
        console.log('Дальше вкладка Пины → «В таблицу на автопубликацию».');
      });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/pins/board') {
      const body = await readBody(req);
      const slug = String(body.theme ?? body.slug ?? '').trim();
      const boardId = String(body.boardId ?? '').trim();
      const saved = await savePinBoardId(slug, boardId);
      return send(res, 200, { ok: true, ...saved });
    }
    if (req.method === 'POST' && url.pathname === '/api/pins/clear-shipped') {
      startJob('Убираю с диска пины, которые уже в таблице', () => removeShippedLocalFiles().then(() => undefined));
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/pins/publish') {
      const body = await readBody(req).catch(() => ({}));
      const theme = String((body as { theme?: string }).theme ?? '').trim();
      const label = theme
        ? `Выпуск пинов в таблицу: ${theme}`
        : 'Выпуск пинов: хранилище и таблица';
      startJob(label, () => publishPins(theme || undefined));
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/pins') {
      const body = await readBody(req);
      const theme = body.theme ? String(body.theme) : undefined;
      const mode = (['collection', 'single', 'both'].includes(String(body.mode))
        ? String(body.mode)
        : 'both') as PinMode;
      const slugs = Array.isArray(body.slugs) ? body.slugs.map(String) : undefined;
      const accentRaw = body.accent ? String(body.accent).trim() : '';
      const accent = /^#[0-9a-fA-F]{6}$/i.test(accentRaw) ? accentRaw : undefined;
      const bundleRaw = String(body.collectionBundles ?? 'classic');
      const collectionBundles =
        bundleRaw === 'overlay' || bundleRaw === 'classic' || bundleRaw === 'both'
          ? bundleRaw
          : 'classic';
      const overlayRaw = String(body.overlayColor ?? 'random');
      const overlayColor =
        overlayRaw === 'blue' ||
        overlayRaw === 'red' ||
        overlayRaw === 'green' ||
        overlayRaw === 'yellow' ||
        overlayRaw === 'random'
          ? overlayRaw
          : 'random';
      const options: PinBuildOptions = {
        theme,
        mode,
        slugs,
        removeOld: Boolean(body.removeOld),
        writeCopy: Boolean(body.writeCopy),
        keywords: body.keywords ? String(body.keywords) : '',
        accent,
        heading: body.heading ? String(body.heading).trim() : undefined,
        collectionBundles,
        overlayColor,
        rebuildClassic: Boolean(body.rebuildClassic),
        singleStyle:
          body.singleStyle === 'badge' || body.singleStyle === 'both' || body.singleStyle === 'plain'
            ? body.singleStyle
            : 'plain',
      };
      const label = [
        theme ? `Пины ${theme}` : 'Пины всех подборок',
        mode === 'collection' ? 'только бандлы' : mode === 'single' ? 'только одиночные' : 'бандлы и одиночные',
        options.writeCopy ? 'с текстом для Pinterest' : 'без текста',
        options.singleStyle === 'badge' ? 'одиночные с бейджем' : '',
        options.singleStyle === 'both' ? 'одиночные обычные и с бейджем' : '',
        mode === 'collection' || mode === 'both' ? `бандлы: ${collectionBundles}` : '',
        collectionBundles === 'overlay' || collectionBundles === 'both'
          ? `рамка ${overlayColor}`
          : '',
        mode === 'collection' || mode === 'both' ? 'старые бандлы не трогаю' : '',
        options.removeOld ? 'затереть одиночные' : '',
        options.heading ? `надпись «${options.heading}»` : '',
        accent ? `плашка ${accent}` : '',
      ]
        .filter(Boolean)
        .join(', ');
      startJob(label, async () => {
        await buildPins(options);
        console.log('Дальше вкладка Пины → синяя кнопка «В таблицу на автопубликацию».');
      });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/redraw') {
      const body = await readBody(req);
      const theme = body.theme ? String(body.theme) : undefined;
      const slugs = Array.isArray(body.slugs) ? body.slugs.map(String) : undefined;
      const label = slugs?.length
        ? `Перерисовка ${theme ?? ''}: ${slugs.length} выбранных листов`
        : theme ? `Перерисовка ${theme}` : 'Перерисовка всех листов';
      startJob(label, async () => {
        await redraw(theme, undefined, slugs);
        console.log('Выкладываю перерисованные PNG и PDF в хранилище.');
        try {
          await uploadThemePrints(theme ?? '');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`На диске обновлено, в хранилище не вышло: ${message}`);
          console.log('На странице рисования нажмите «Выложить в хранилище».');
        }
      });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/refit/sheets') {
      const theme = url.searchParams.get('theme') ?? '';
      if (!theme) throw new Error('Укажите тему.');
      return send(res, 200, { sheets: await listRefitSheets(theme) });
    }
    if (req.method === 'POST' && url.pathname === '/api/refit') {
      const body = await readBody(req);
      const theme = String(body.theme ?? '').trim();
      if (!theme) throw new Error('Укажите подборку.');
      const slugs = Array.isArray(body.slugs) ? body.slugs.map(String) : undefined;
      const age = body.age ? String(body.age) : undefined;
      const items = Array.isArray(body.items)
        ? (body.items as { slug?: string; stripFrame?: boolean }[])
            .filter((item) => item && item.slug)
            .map((item) => ({ slug: String(item.slug), stripFrame: Boolean(item.stripFrame) }))
        : undefined;
      startJob(`Поправка с сайта: ${theme}`, async () => {
        const result = await refitFromSite({ theme, slugs, age, items });
        console.log(
          result.failed.length
            ? `Поправлено ${result.ok}/${result.total}. Часть не вышла — смотри лог.`
            : `Поправлено ${result.ok}/${result.total}. Можно обновить сайт.`,
        );
      });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/draw-prompts') {
      return send(res, 200, {
        file: drawPromptFile,
        prompts: currentDrawPrompts(),
        defaults: defaultDrawPrompts,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/draw-prompts') {
      const body = await readBody(req);
      if (body.reset === true) {
        const prompts = resetDrawPrompts();
        return send(res, 200, { ok: true, file: drawPromptFile, prompts });
      }
      const prompts = saveDrawPrompts(body.prompts ?? body);
      return send(res, 200, { ok: true, file: drawPromptFile, prompts });
    }
    if (req.method === 'POST' && url.pathname === '/api/draw-prompts/preview') {
      const body = await readBody(req);
      return send(res, 200, previewDraw(body));
    }
    if (req.method === 'POST' && url.pathname === '/api/create') {
      const body = await readBody(req);
      await createPages({
        theme: body.theme ? String(body.theme) : undefined,
        title: body.title ? String(body.title) : undefined,
        slug: body.slug ? String(body.slug) : undefined,
        kind: body.kind ? String(body.kind) : undefined,
        ideas: body.ideas ? String(body.ideas) : undefined,
        age: body.age ? String(body.age) : undefined,
      });
      return send(res, 202, { ok: true });
    }
    send(res, 404, { error: 'Не найдено' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send(res, 400, { error: message });
  }
});

void loadSession().finally(() => {
  server.listen(port, '127.0.0.1', () => {
    const address = `http://127.0.0.1:${port}`;
    console.log(address);
    exec(`start "" "${address}"`);
  });
});
