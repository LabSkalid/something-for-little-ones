import fs from 'node:fs';
import path from 'node:path';

const pinRoot = 'D:/KIDS/site/public/pins';
const siteBase = 'https://somethingforlittleones.com';
const outDir = 'D:/KIDS/factory/out/pinterest';

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(png|jpg|jpeg|webp)$/i.test(name)) acc.push(p);
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

/** Strip URLs and collapse whitespace — Pinterest link is a separate field. */
function cleanText(s) {
  return String(s ?? '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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

const themes = [
  {
    key: 'thanksgiving',
    prefix: 'thanksgiving-coloring-pages-',
    board: 'thanksgiving',
    boardId: '1086000966335597727', // Thanksgiving Coloring Pages
  },
  {
    key: 'winter',
    prefix: 'winter-coloring-pages-',
    board: 'winter',
    boardId: '1086000966335621162', // Winter Coloring Pages
  },
  {
    key: 'christmas',
    prefix: 'christmas-coloring-pages-',
    board: 'christmas',
    boardId: '1086000966335621302', // Christmas Coloring Pages
  },
];

const summary = {};
const outRows = [];
const missing = [];

for (const t of themes) {
  summary[t.key] = { root: 0, alreadyInDone: 0, withCopy: 0, missingCopy: 0, queued: 0 };
  for (const [baseLower, fileName] of rootPending) {
    if (!baseLower.startsWith(t.prefix)) continue;
    summary[t.key].root++;
    if (doneBasenames.has(baseLower)) {
      summary[t.key].alreadyInDone++;
      continue;
    }
    const meta = byFile.get(baseLower);
    const title = cleanText(meta?.title || '');
    const description = cleanText(meta?.description || '');
    const link =
      (meta?.link || '').trim() ||
      (baseLower.includes('-collection-') ? `${siteBase}/${t.key}-coloring-pages/` : '');

    if (title && description) summary[t.key].withCopy++;
    else {
      summary[t.key].missingCopy++;
      missing.push({
        filename: fileName,
        board: t.board,
        hasCsvRow: Boolean(meta),
        link: meta?.link || '',
      });
      continue;
    }

    summary[t.key].queued++;
    outRows.push({
      filename: fileName,
      board: t.board,
      board_id: t.boardId,
      image_url: `https://files.somethingforlittleones.com/pins/${fileName.replace(/\.png$/i, ".jpg")}`,
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
}

const order = { thanksgiving: 0, winter: 1, christmas: 2 };
outRows.sort(
  (a, b) => order[a.board] - order[b.board] || a.filename.localeCompare(b.filename),
);

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
fs.writeFileSync(path.join(outDir, 'missing-copy.json'), JSON.stringify(missing, null, 2));
fs.writeFileSync(
  path.join(outDir, 'queue-summary.json'),
  JSON.stringify(
    {
      summary,
      queued: outRows.length,
      missingCopy: missing.length,
      doneBasenames: doneBasenames.size,
      out: path.join(outDir, 'make-queue.csv'),
    },
    null,
    2,
  ),
);

console.log(JSON.stringify({ summary, queued: outRows.length, missingCopy: missing.length }, null, 2));
console.log(`Wrote ${path.join(outDir, 'make-queue.csv')}`);
