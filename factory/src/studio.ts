import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { buildPins } from './build-assets.ts';
import { loadEnv } from './env.ts';
import {
  type AgeBand,
  type DraftSheet,
  commitImport,
  nameDraftWithVision,
  scanImportFolder,
} from './import-stock.ts';
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
  lastTheme: string;
};

const job: Job = { running: false, log: [], error: '', drafts: null, lastTheme: '' };

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

function parseIdeas(text: string) {
  const used = new Set<string>();
  const ideas = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const splitAt = line.indexOf(':');
    const name = (splitAt === -1 ? line : line.slice(0, splitAt)).trim();
    const prompt = (splitAt === -1 ? line : line.slice(splitAt + 1)).trim() || name;
    let slug = slugify(name.replace(/coloring page/i, ''));
    if (!slug) continue;
    while (used.has(slug)) slug = `${slug}-2`;
    used.add(slug);
    const title = /coloring page/i.test(name) ? name : `${name} Coloring Page`;
    ideas.push({ slug, title, prompt, difficulty: 'easy', age: '3-4' });
  }
  return ideas;
}

function startJob(label: string, task: () => Promise<void>) {
  if (job.running) throw new Error('Уже выполняется другая задача. Дождитесь окончания.');
  job.running = true;
  job.error = '';
  job.log = [label];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map((item) => String(item)).join(' ');
    job.log.push(line);
    original(line);
  };
  void task()
    .catch((error: unknown) => {
      job.error = error instanceof Error ? error.message : String(error);
      job.log.push(job.error);
    })
    .finally(() => {
      console.log = original;
      job.running = false;
      job.log.push(job.error ? 'Остановлено из-за ошибки.' : 'Готово. Обновите сайт в браузере или соберите сайт заново.');
    });
}

async function createPages(body: { theme?: string; title?: string; kind?: string; ideas?: string }) {
  const ideas = parseIdeas(body.ideas ?? '');
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
    if (Array.isArray(data.related) && data.related.length) related = data.related.map(String);
  }
  const brief = {
    slug,
    title,
    tagline: `Free ${title.toLowerCase()} for kids ages 3 to 4.`,
    description: `Free ${title.toLowerCase()} to print for kids.`,
    kind,
    ageBand: '3-4',
    order,
    accent,
    ink,
    keywords: [title.toLowerCase()],
    related: related.filter((item) => item !== slug).slice(0, 2),
    audience: 'parents of children ages 3 to 4',
    style: 'Cute storybook line art, thick black outlines, white background, no shading, no text, no trademarked characters.',
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
      const sheets = await scanImportFolder(folder, (String(body.defaultAge ?? '3-4') as AgeBand) || '3-4');
      job.drafts = sheets;
      return send(res, 200, { sheets });
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
            named.push(await nameDraftWithVision(sheet));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.log(`не назвался: ${message}`);
            named.push(sheet);
          }
        }
        const byId = new Map(named.map((sheet) => [sheet.id, sheet]));
        job.drafts = (job.drafts ?? sheets).map((sheet) => byId.get(sheet.id) ?? sheet);
        console.log('Названия обновлены. Проверьте таблицу и нажмите «Залить на сайт».');
      });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/import/commit') {
      const body = await readBody(req);
      const sheets = asDraftSheets(body.sheets);
      startJob('Импорт стока на сайт', async () => {
        const result = await commitImport({
          theme: String(body.theme ?? ''),
          title: body.title ? String(body.title) : undefined,
          kind: body.kind === 'seasonal' ? 'seasonal' : 'evergreen',
          ageBand: (String(body.ageBand ?? '3-4') as AgeBand) || '3-4',
          sheets,
        });
        job.lastTheme = result.theme;
        console.log(`Готово: ${result.published.length} листов в ${result.theme}`);
        console.log('Новая тема сама появится в футере. На главной праздники и лишние темы подхватываются автоматически.');
        console.log('Чтобы собрать пины: кнопка «Пины этой темы» или вкладка «Рисовать и пины».');
      });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/pins') {
      const body = await readBody(req);
      const theme = body.theme ? String(body.theme) : undefined;
      startJob(theme ? `Пины ${theme}` : 'Пины всех подборок', () => buildPins(theme));
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
      });
      return send(res, 202, { ok: true });
    }
    send(res, 404, { error: 'Не найдено' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send(res, 400, { error: message });
  }
});

server.listen(port, '127.0.0.1', () => {
  const address = `http://127.0.0.1:${port}`;
  console.log(address);
  exec(`start "" "${address}"`);
});
