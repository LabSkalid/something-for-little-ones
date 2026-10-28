import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Paths. The environment variables exist only for testing; normally the defaults are used.
const here = path.dirname(fileURLToPath(import.meta.url));
const pinRoot = process.env.PIN_ROOT || 'D:/KIDS/site/public/pins';
const outDir = process.env.OUT_DIR || 'D:/KIDS/factory/out/pinterest';
const cfgPath = process.env.BOARDS_JSON || path.join(here, 'boards.json');

// Boards, priorities and URLs live in boards.json (next to this script).
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
const siteBase = cfg.siteBase;
const imageBase = cfg.imageBase;

const onlyTheme = String(process.env.PIN_THEME ?? '')
  .trim()
  .toLowerCase()
  .replace(/-coloring-pages$/, '');

function makeTheme(key, extra = {}) {
  return {
    key,
    board: extra.board || key,
    boardId: String(extra.boardId ?? '').trim(),
    tier: Number(extra.tier ?? 9),
    weight: Math.max(1, Number(extra.weight ?? 1)),
    prefix: `${key}-coloring-pages-`,
  };
}

const themes = cfg.themes.map((t) => {
  const theme = makeTheme(t.key, t);
  if (theme.boardId && !/^\d+$/.test(theme.boardId)) {
    throw new Error(`boards.json: boardId for "${t.key}" must be digits only, got "${theme.boardId}"`);
  }
  return theme;
});

function emptySummary() {
  return {
    root: 0,
    alreadyInDone: 0,
    withCopy: 0,
    missingCopy: 0,
    noFreshJpg: 0,
    waitingForBoardId: 0,
    queued: 0,
  };
}

function ensureTheme(key) {
  let theme = themes.find((item) => item.key === key);
  if (theme) return theme;
  theme = makeTheme(key);
  themes.push(theme);
  return theme;
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, acc);
    // PNG only: the JPG copies made by publish.bat must not be treated as separate pins.
    else if (/\.png$/i.test(name)) acc.push(p);
  }
  return acc;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQ = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x !== ''));
}

function esc(s) {
  const t = String(s ?? '');
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

/** Strip URLs and collapse whitespace. The Pinterest link is a separate field. */
function cleanText(s) {
  return String(s ?? '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Take `weight` pins from each theme in turn until all lists are empty. */
function interleave(groups) {
  const out = [];
  const queues = groups.map((g) => ({ rows: [...g.rows], weight: g.weight }));
  while (queues.some((q) => q.rows.length)) {
    for (const q of queues) {
      for (let i = 0; i < q.weight && q.rows.length; i++) out.push(q.rows.shift());
    }
  }
  return out;
}

const byName = (a, b) => a.filename.localeCompare(b.filename, 'en', { numeric: true });

const themeOf = (baseLower) => themes.find((t) => baseLower.startsWith(t.prefix));
const guessTheme = (baseLower) =>
  baseLower.includes('-coloring-pages-') ? baseLower.split('-coloring-pages-')[0] : '(no theme)';

// Which pins exist: root of pins/ = not yet on Pinterest, pins/done/** = already there.
const allFiles = walk(pinRoot);
const doneBasenames = new Set();
const rootPending = new Map();

for (const abs of allFiles) {
  const rel = path.relative(pinRoot, abs).split(path.sep).join('/');
  const base = path.basename(abs);
  const parts = rel.split('/');
  if (parts[0] === 'done') doneBasenames.add(base.toLowerCase());
  else if (parts.length === 1) rootPending.set(base.toLowerCase(), base);
}

// Titles and descriptions written by the factory.
const csvRaw = fs.readFileSync(path.join(pinRoot, 'pins.csv'), 'utf8');
const byFile = new Map();
for (const r of parseCsv(csvRaw).slice(1)) {
  const filename = (r[0] || '').trim();
  if (!filename) continue;
  byFile.set(filename.toLowerCase(), {
    filename,
    type: r[1] || '',
    theme: r[2] || '',
    link: r[3] || '',
    title: (r[4] || '').trim(),
    description: (r[5] || '').trim(),
    keywords: (r[6] || '').trim(),
  });
}

const summary = {};
const rowsByTheme = new Map();
const missing = [];
const noJpg = [];
const unknownThemes = {};

function themeBucket(t) {
  if (!summary[t.key]) summary[t.key] = emptySummary();
  if (!rowsByTheme.has(t.key)) rowsByTheme.set(t.key, []);
  return t;
}

for (const [baseLower, fileName] of rootPending) {
  let t = themeOf(baseLower);
  const guessed = t?.key || guessTheme(baseLower);
  if (guessed === '(no theme)') continue;
  if (onlyTheme && guessed !== onlyTheme) continue;
  t = t || ensureTheme(guessed);
  themeBucket(t);

  const s = summary[t.key];
  s.root++;
  if (doneBasenames.has(baseLower)) {
    s.alreadyInDone++;
    continue;
  }

  if (!t.boardId) s.waitingForBoardId++;

  const meta = byFile.get(baseLower);
  const title = cleanText(meta?.title || '');
  const description = cleanText(meta?.description || '');
  const link =
    (meta?.link || '').trim() ||
    (baseLower.includes('-collection-') ? `${siteBase}/${t.key}-coloring-pages/` : '');

  if (!title || !description) {
    s.missingCopy++;
    missing.push({ filename: fileName, board: t.board, hasCsvRow: Boolean(meta), link: meta?.link || '' });
    continue;
  }
  s.withCopy++;

  // Only queue pins whose JPG exists and is not older than the PNG (publish.bat makes and uploads it).
  const jpgName = fileName.replace(/\.png$/i, '.jpg');
  const pngPath = path.join(pinRoot, fileName);
  const jpgPath = path.join(pinRoot, jpgName);
  if (!fs.existsSync(jpgPath) || fs.statSync(jpgPath).mtimeMs < fs.statSync(pngPath).mtimeMs) {
    s.noFreshJpg++;
    noJpg.push(fileName);
    continue;
  }

  s.queued++;
  rowsByTheme.get(t.key).push({
    filename: fileName,
    board: t.board,
    board_id: t.boardId,
    image_url: `${imageBase}/${jpgName}`,
    title,
    description,
    link: link || meta?.link || '',
    status: 'ready',
    post_at: '',
    pin_id: '',
    posted_at: '',
    notes: '',
  });
}

// Order: tier 1 first, then tier 2, and so on. Inside a tier the themes are mixed in turn.
const tiers = [...new Set(themes.map((t) => t.tier))].sort((a, b) => a - b);
const outRows = [];
for (const tier of tiers) {
  const groups = themes
    .filter((t) => t.tier === tier)
    .map((t) => ({ rows: (rowsByTheme.get(t.key) ?? []).sort(byName), weight: t.weight }));
  outRows.push(...interleave(groups));
}

const header = [
  'filename',
  'board',
  'board_id',
  'image_url',
  'title',
  'description',
  'link',
  'status',
  'post_at',
  'pin_id',
  'posted_at',
  'notes',
];
const lines = [header.join(',')];
for (const r of outRows) lines.push(header.map((h) => esc(r[h])).join(','));

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'make-queue.csv'), `${lines.join('\n')}\n`);
// studio.ts consumes JSON; keep CSV for human inspection and JSON for the webhook.
fs.writeFileSync(path.join(outDir, 'make-queue.json'), JSON.stringify(outRows, null, 2));
fs.writeFileSync(path.join(outDir, 'missing-copy.json'), JSON.stringify(missing, null, 2));
fs.writeFileSync(
  path.join(outDir, 'queue-summary.json'),
  JSON.stringify(
    {
      summary,
      queued: outRows.length,
      missingCopy: missing.length,
      noFreshJpg: noJpg.length,
      doneBasenames: doneBasenames.size,
      out: path.join(outDir, 'make-queue.csv'),
    },
    null,
    2,
  ),
);

console.log(JSON.stringify({ summary, queued: outRows.length, missingCopy: missing.length }, null, 2));
console.log(`Wrote ${path.join(outDir, 'make-queue.csv')}`);

// Human-readable notes
const waiting = themes.filter((t) => (summary[t.key]?.waitingForBoardId ?? 0) > 0);
if (waiting.length) {
  console.log(
    `\nВ таблице без доски Pinterest (впишите boardId в boards.json, иначе Make не знает куда постить): ${waiting
      .map((t) => `${t.key} (${summary[t.key].waitingForBoardId})`)
      .join(', ')}`,
  );
}
const unknown = Object.entries(unknownThemes);
if (unknown.length) {
  console.log(`Темы, которых нет в boards.json: ${unknown.map(([k, n]) => `${k} (${n})`).join(', ')}`);
}
if (noJpg.length) {
  console.log(`\nУ ${noJpg.length} пинов нет свежего JPG. Запустите publish.bat и соберите очередь заново.`);
}
