import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { buildPins, listPinSheets, type PinBuildOptions, type PinMode } from './build-assets.ts';
import { loadEnv } from './env.ts';
import {
  type AgeBand,
  type DraftSheet,
  commitImport,
  matchDraftsToTheme,
  nameDraftWithVision,
  scanImportFolder,
} from './import-stock.ts';
import {
  applyImportCaptions,
  buildKdpBook,
  listKdpPages,
  nameKdpPage,
  type KdpPage,
} from './kdp-book.ts';
import { produce } from './produce.ts';
import { redraw } from './redraw.ts';
import { briefsRoot, factoryRoot, sheetContentRoot, themeContentRoot } from './paths.ts';

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
};

const job: Job = { running: false, log: [], error: '', drafts: null, kdpPages: null, lastTheme: '' };
const sessionPath = path.join(factoryRoot, '.cache', 'studio-session.json');

type StudioSession = {
  drafts: DraftSheet[] | null;
  kdpPages: KdpPage[] | null;
  lastTheme: string;
  savedAt: string;
};

async function saveSession() {
  try {
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    const payload: StudioSession = {
      drafts: job.drafts,
      kdpPages: job.kdpPages,
      lastTheme: job.lastTheme,
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
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

async function listThemes() {
  const files = (await fs.readdir(themeContentRoot)).filter((name) => name.endsWith('.md'));
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
      count,
    });
  }
  themes.sort((a, b) => a.title.localeCompare(b.title));
  return themes;
}

const ageDifficulty: Record<string, 'toddler' | 'easy' | 'medium' | 'detailed'> = {
  '2-3': 'toddler',
  '3-4': 'easy',
  '4-5': 'medium',
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
    const name = (splitAt === -1 ? line : line.slice(0, splitAt)).trim();
    let prompt = (splitAt === -1 ? line : line.slice(splitAt + 1)).trim() || name;
    // produce() requires prompt length >= 8
    if (prompt.length < 8) prompt = `a simple ${prompt} coloring page drawing`;
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
  let related = ['animal-coloring-pages'];
  let ageBand = age;
  if (!existing) {
    title = (body.title ?? '').trim();
    if (title.length < 3) throw new Error('Напишите название новой подборки.');
    slug = /coloring-pages$/.test(slugify(title)) ? slugify(title) : `${slugify(title)}-coloring-pages`;
    if (themes.some((theme) => theme.slug === slug)) throw new Error('Такая подборка уже есть. Выберите её в списке.');
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
    related: related.filter((item) => item !== slug).slice(0, 2),
    audience: `parents of children ages ${agesLabel}`,
    style:
      age === '2-3'
        ? 'Toddler coloring page, one huge simple object, extra-thick black outlines, almost no small parts, pure white background, no shading, no text, no trademarked characters.'
        : 'Cute storybook line art, thick black outlines, white background, no shading, no text, no trademarked characters.',
    ideas,
    pins: [{ id: 'set', title: `Free ${title}`, subtitle: 'Printable coloring pages' }],
  };
  const cache = path.join(factoryRoot, '.cache');
  await fs.mkdir(cache, { recursive: true });
  const briefPath = path.join(cache, 'studio-brief.yaml');
  await fs.writeFile(briefPath, stringify(brief));
  await fs.mkdir(briefsRoot, { recursive: true });
  startJob(`Новые рисунки: ${ideas.map((idea) => idea.slug).join(', ')}`, () => produce(briefPath, false));
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, await fs.readFile(uiPath, 'utf8'), 'text/html');
    }
    if (req.method === 'GET' && url.pathname === '/api/themes') return send(res, 200, await listThemes());
    if (req.method === 'GET' && url.pathname === '/api/job') {
      return send(res, 200, {
        running: job.running,
        log: job.log,
        error: job.error,
        drafts: job.drafts,
        kdpPages: job.kdpPages,
        lastTheme: job.lastTheme,
      });
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
      let sheets = await scanImportFolder(folder, (String(body.defaultAge ?? '3-4') as AgeBand) || '3-4');
      const theme = String(body.theme ?? '').trim();
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
        console.log('Названия обновлены и сохранены. Можно перезапускать фабрику — они не пропадут.');
        console.log('Для книги: Amazon KDP → Открыть папку → Взять названия из импорта.');
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
      startJob(`KDP книга: ${title}`, async () => {
        const result = await buildKdpBook({
          folder,
          title,
          subtitle: body.subtitle ? String(body.subtitle) : undefined,
          author: body.author ? String(body.author) : undefined,
          copyright: body.copyright ? String(body.copyright) : undefined,
          outFile: body.outFile ? String(body.outFile) : undefined,
          blankBacks: body.blankBacks !== false,
          frontMatter: body.frontMatter !== false,
          captions: body.captions !== false,
          pages,
        });
        console.log(`Открой файл и загрузи в KDP как Interior.`);
        console.log(result.outFile);
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
          kind: body.kind === 'seasonal' ? 'seasonal' : 'evergreen',
          ageBand: (String(body.ageBand ?? '3-4') as AgeBand) || '3-4',
          sheets,
          imagesOnly,
        });
        job.lastTheme = result.theme;
        if (imagesOnly) {
          console.log(`Готово: обновлены картинки у ${result.published.length} листов в ${result.theme}`);
        } else {
          console.log(`Готово: ${result.published.length} листов в ${result.theme}`);
          console.log('Новая тема сама появится в футере. На главной праздники и лишние темы подхватываются автоматически.');
          console.log('Чтобы собрать пины: кнопка «Пины этой темы» или вкладка «Рисовать и пины».');
        }
      });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/pins/sheets') {
      const theme = url.searchParams.get('theme') ?? '';
      if (!theme) throw new Error('Укажите тему.');
      return send(res, 200, { sheets: await listPinSheets(theme) });
    }
    if (req.method === 'POST' && url.pathname === '/api/pins') {
      const body = await readBody(req);
      const theme = body.theme ? String(body.theme) : undefined;
      const mode = (['collection', 'single', 'both'].includes(String(body.mode))
        ? String(body.mode)
        : 'both') as PinMode;
      const slugs = Array.isArray(body.slugs) ? body.slugs.map(String) : undefined;
      const options: PinBuildOptions = {
        theme,
        mode,
        slugs,
        collectionCount: body.collectionCount ? Number(body.collectionCount) : 2,
        removeOld: Boolean(body.removeOld),
        writeCopy: Boolean(body.writeCopy),
        framed: body.framed !== false,
        keywords: body.keywords ? String(body.keywords) : '',
      };
      const label = [
        theme ? `Пины ${theme}` : 'Пины всех подборок',
        mode === 'collection' ? 'только бандлы' : mode === 'single' ? 'только одиночные' : 'бандлы и одиночные',
        options.writeCopy ? 'с текстом для Pinterest' : 'без текста',
        mode !== 'single' ? (options.framed !== false ? 'с рамками' : 'без рамок') : '',
      ]
        .filter(Boolean)
        .join(', ');
      startJob(label, () => buildPins(options));
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/redraw') {
      const body = await readBody(req);
      const theme = body.theme ? String(body.theme) : undefined;
      startJob(theme ? `Перерисовка ${theme}` : 'Перерисовка всех листов', () => redraw(theme));
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/create') {
      const body = await readBody(req);
      await createPages({
        theme: body.theme ? String(body.theme) : undefined,
        title: body.title ? String(body.title) : undefined,
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
