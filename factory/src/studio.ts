import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { produce } from './produce.ts';
import { redraw } from './redraw.ts';
import { briefsRoot, factoryRoot, sheetContentRoot, themeContentRoot } from './paths.ts';

const port = 4317;

type Job = {
  running: boolean;
  log: string[];
  error: string;
};

const job: Job = { running: false, log: [], error: '' };

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
  if (job.running) {
    const error = new Error('Уже выполняется другая задача. Дождитесь окончания.');
    throw error;
  }
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
      job.log.push(job.error ? 'Остановлено из-за ошибки.' : 'Готово. Обновите сайт в браузере.');
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
    pins: [
      { id: 'set', title: `Free ${title}`, subtitle: 'Printable coloring pages' },
    ],
  };
  const cache = path.join(factoryRoot, '.cache');
  await fs.mkdir(cache, { recursive: true });
  const briefPath = path.join(cache, 'studio-brief.yaml');
  await fs.writeFile(briefPath, stringify(brief));
  await fs.mkdir(briefsRoot, { recursive: true });
  startJob(`Новые рисунки: ${ideas.map((idea) => idea.slug).join(', ')}`, () => produce(briefPath, false));
}

const page = `<!doctype html>
<html lang="ru">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Фабрика</title>
<style>
  body { margin: 0; font: 16px/1.45 "Segoe UI", sans-serif; color: #243038; background: #fff; }
  main { width: min(760px, calc(100% - 2rem)); margin: 1.5rem auto 3rem; }
  h1 { font-size: 1.7rem; margin: 0 0 0.3rem; }
  p { color: #5c676e; }
  label { display: block; font-weight: 700; margin: 0.9rem 0 0.3rem; }
  input, select, textarea { width: 100%; box-sizing: border-box; font: inherit; padding: 0.55rem 0.7rem; border: 1px solid #e4e8eb; border-radius: 10px; }
  textarea { min-height: 9rem; }
  button, .btn { border: 0; border-radius: 10px; background: #1d7ad6; color: white; font-weight: 800; padding: 0.65rem 0.9rem; cursor: pointer; }
  button.quiet, .quiet { background: white; color: #243038; box-shadow: inset 0 0 0 1.5px #e4e8eb; }
  .row { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.8rem; }
  article { display: flex; justify-content: space-between; gap: 1rem; align-items: center; padding: 0.75rem 0; border-bottom: 1px solid #e4e8eb; }
  article h2 { font-size: 1rem; margin: 0; }
  article p { margin: 0.15rem 0 0; }
  pre { white-space: pre-wrap; background: #f6f7f8; border-radius: 10px; padding: 0.8rem; min-height: 6rem; }
  .hidden { display: none; }
</style>
<main>
  <h1>Фабрика</h1>
  <p>Новые рисунки и перерисовка уже готовых листов. Сайт при этом должен быть открыт локально, чтобы увидеть результат. Ключ берётся из factory/.env.</p>
  <section id="themes"></section>
  <h2>Новые рисунки</h2>
  <label for="theme">Подборка</label>
  <select id="theme"></select>
  <div id="new-fields" class="hidden">
    <label for="title">Название новой подборки</label>
    <input id="title" placeholder="Ocean Coloring Pages">
    <label for="kind">Тип</label>
    <select id="kind"><option value="evergreen">На любой день</option><option value="seasonal">Сезонная</option></select>
  </div>
  <label for="ideas">Рисунки, каждый с новой строки</label>
  <textarea id="ideas" placeholder="Whale: a friendly whale spouting water&#10;Starfish: one large starfish"></textarea>
  <div class="row">
    <button id="create" type="button">Нарисовать новые</button>
    <button id="redraw-all" class="quiet" type="button">Перерисовать все листы</button>
  </div>
  <h2>Ход работы</h2>
  <pre id="log">Пока ничего не запущено.</pre>
</main>
<script>
  const themesEl = document.querySelector('#themes');
  const themeSelect = document.querySelector('#theme');
  const newFields = document.querySelector('#new-fields');
  const logEl = document.querySelector('#log');

  function paintThemes(themes) {
    themesEl.innerHTML = themes.map((theme) => \`
      <article>
        <div><h2>\${theme.title}</h2><p>\${theme.count} листов</p></div>
        <button class="quiet" type="button" data-redraw="\${theme.slug}">Перерисовать</button>
      </article>\`).join('');
    const current = themeSelect.value;
    themeSelect.innerHTML = '<option value="">Новая подборка</option>' + themes.map((theme) => \`<option value="\${theme.slug}">\${theme.title}</option>\`).join('');
    themeSelect.value = current;
    newFields.classList.toggle('hidden', themeSelect.value !== '');
  }

  async function loadThemes() {
    const themes = await fetch('/api/themes').then((res) => res.json());
    paintThemes(themes);
  }

  themeSelect.addEventListener('change', () => {
    newFields.classList.toggle('hidden', themeSelect.value !== '');
  });

  themesEl.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-redraw]');
    if (!button) return;
    if (!confirm('Перерисовать все листы этой подборки? Тексты останутся, картинки заменятся.')) return;
    await fetch('/api/redraw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: button.dataset.redraw }) });
  });

  document.querySelector('#redraw-all').addEventListener('click', async () => {
    if (!confirm('Перерисовать все листы всех подборок? Это платный запрос к модели.')) return;
    await fetch('/api/redraw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  });

  document.querySelector('#create').addEventListener('click', async () => {
    const response = await fetch('/api/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme: themeSelect.value,
        title: document.querySelector('#title').value,
        kind: document.querySelector('#kind').value,
        ideas: document.querySelector('#ideas').value,
      }),
    });
    const data = await response.json();
    if (!response.ok) logEl.textContent = data.error || 'Не получилось запустить.';
  });

  let wasRunning = false;
  async function poll() {
    const data = await fetch('/api/job').then((res) => res.json());
    if (data.log?.length) logEl.textContent = data.log.join('\\n');
    if (wasRunning && !data.running) loadThemes();
    wasRunning = Boolean(data.running);
  }

  loadThemes();
  setInterval(poll, 2000);
</script>
`;

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
  return JSON.parse(raw) as Record<string, string>;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, page, 'text/html');
    if (req.method === 'GET' && url.pathname === '/api/themes') return send(res, 200, await listThemes());
    if (req.method === 'GET' && url.pathname === '/api/job') return send(res, 200, job);
    if (req.method === 'POST' && url.pathname === '/api/redraw') {
      const body = await readBody(req);
      startJob(body.theme ? `Перерисовка ${body.theme}` : 'Перерисовка всех листов', () => redraw(body.theme || undefined));
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/create') {
      const body = await readBody(req);
      await createPages(body);
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
