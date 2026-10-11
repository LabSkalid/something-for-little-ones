import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import { loadEnv } from './env.ts';
import {
  coloringPrompt,
  generateColoringPage,
  visionChat,
  type LineDifficulty,
} from './openrouter.ts';
import { fitPortrait } from './lineart.ts';
import { stripSiteFooter } from './footer.ts';
import { factoryRoot } from './paths.ts';
import { listKdpPages, type KdpPage } from './kdp-book.ts';

export type AuditScore = {
  index: number;
  file: string;
  basename: string;
  subject: string;
  /** 1–5 relative to this book (from local ink/edge density). */
  complexity: number;
  /** Raw local busyness score (higher = more detailed). */
  inkScore: number;
  lineWeight: 'thin' | 'medium' | 'thick';
  styleTag: string;
  note: string;
  flag: 'ok' | 'too-simple' | 'too-complex' | 'style-mismatch';
  reason: string;
};

export type AuditReport = {
  folder: string;
  targetComplexity: number;
  targetDifficulty: LineDifficulty;
  targetLineWeight: 'thin' | 'medium' | 'thick';
  styleGuide: string;
  medianInk: number;
  scores: AuditScore[];
  flagged: AuditScore[];
  outDir: string;
  reportFile: string;
};

export type AuditOptions = {
  folder: string;
  pages?: KdpPage[];
  /** Also call the paid image model for flagged pages. Default false. */
  redraw?: boolean;
  /** Target age band for redraw prompts. */
  age?: string;
  styleHint?: string;
  /**
   * Continue into an existing audit folder: skip pages that already have
   * `NN-*.png` redraws, only generate the missing ones.
   */
  resumeDir?: string;
  /**
   * When scoring, prefer redraw PNGs from this folder (so a second pass
   * sees the book after replacements).
   */
  overridesDir?: string;
  /**
   * Manual list: page numbers and/or filenames, comma/newline separated
   * (e.g. "41, 47, striped-mitten, santa-claus.png").
   * When set with redraw, only these are regenerated (overwrites existing).
   */
  select?: string;
  /** Extra folder of images to redraw into the book style (not necessarily in the book). */
  extraFolder?: string;
  /** Overwrite existing NN-*.png in outDir. Default false (resume skips). */
  overwrite?: boolean;
};

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Модель не вернула JSON.');
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

async function loadRaster(file: string) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.svg') {
    const svg = await fs.readFile(file, 'utf8');
    return Buffer.from(
      new Resvg(svg, { fitTo: { mode: 'width', value: 1600 }, background: 'white' }).render().asPng(),
    );
  }
  return sharp(file).flatten({ background: '#ffffff' }).png().toBuffer();
}

/** Ink + edge density — catches "one mitten" vs "elf factory" better than vision alone. */
async function localInkScore(file: string) {
  let buf = await loadRaster(file);
  buf = await stripSiteFooter(buf);
  try {
    buf = await sharp(buf).trim({ background: '#ffffff', threshold: 18 }).png().toBuffer();
  } catch {
    // keep
  }
  const { data, info } = await sharp(buf)
    .grayscale()
    .resize(400, 520, { fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  let dark = 0;
  let edges = 0;
  let strokeSamples = 0;
  let strokeWidthSum = 0;

  for (let i = 0; i < data.length; i += 1) if (data[i]! < 200) dark += 1;

  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const v = data[i]!;
      if (Math.abs(v - data[i - 1]!) > 40 || Math.abs(v - data[i - w]!) > 40) edges += 1;
      // horizontal run length of dark pixels ≈ stroke thickness samples
      if (v < 140 && data[i - 1]! >= 140) {
        let run = 0;
        for (let xx = x; xx < w && data[y * w + xx]! < 140 && run < 40; xx += 1) run += 1;
        if (run >= 1 && run <= 28) {
          strokeWidthSum += run;
          strokeSamples += 1;
        }
      }
    }
  }

  const ink = dark / data.length;
  const edge = edges / Math.max(1, (w - 2) * (h - 2));
  const score = ink * 40 + edge * 80;
  const avgStroke = strokeSamples ? strokeWidthSum / strokeSamples : 4;
  const lineWeight: AuditScore['lineWeight'] =
    avgStroke >= 7 ? 'thick' : avgStroke <= 3.2 ? 'thin' : 'medium';

  return { score, ink, edge, lineWeight, avgStroke };
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mode<T extends string>(values: T[], fallback: T): T {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = fallback;
  let bestN = -1;
  for (const [value, n] of counts) {
    if (n > bestN) {
      best = value;
      bestN = n;
    }
  }
  return best;
}

function difficultyFromComplexity(complexity: number): LineDifficulty {
  if (complexity <= 1.5) return 'toddler';
  if (complexity <= 2.6) return 'easy';
  if (complexity <= 3.7) return 'medium';
  return 'detailed';
}

function subjectFromFilename(file: string) {
  return path
    .basename(file, path.extname(file))
    .replace(/^bold\s*&?\s*easy\s*/i, '')
    .replace(/^cozy\s*(girl|winter)\s*-?\s*/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .slice(0, 60);
}

/** Map raw ink scores in this book onto 1–5 using percentiles. */
function relativeComplexity(scores: number[]): number[] {
  const sorted = [...scores].sort((a, b) => a - b);
  return scores.map((score) => {
    const rank = sorted.filter((value) => value <= score).length / sorted.length;
    if (rank <= 0.12) return 1;
    if (rank <= 0.3) return 2;
    if (rank <= 0.7) return 3;
    if (rank <= 0.88) return 4;
    return 5;
  });
}

function flagByInk(
  rows: Omit<AuditScore, 'flag' | 'reason' | 'complexity'>[],
  complexities: number[],
  medianInk: number,
  targetLineWeight: AuditScore['lineWeight'],
): AuditScore[] {
  // Relative to THIS book: simple pages ~mitten; busy ~elf factory.
  const lowCut = medianInk * 0.76;
  const highCut = medianInk * 1.28;
  return rows.map((row, i) => {
    const complexity = complexities[i] ?? 3;
    let flag: AuditScore['flag'] = 'ok';
    let reason = '';
    if (row.inkScore < lowCut) {
      flag = 'too-simple';
      reason = `мало деталей (ink ${row.inkScore.toFixed(1)} при медиане ${medianInk.toFixed(1)})`;
    } else if (row.inkScore > highCut) {
      flag = 'too-complex';
      reason = `слишком плотная сцена (ink ${row.inkScore.toFixed(1)} при медиане ${medianInk.toFixed(1)})`;
    } else if (
      (row.lineWeight === 'thin' && targetLineWeight === 'thick') ||
      (row.lineWeight === 'thick' && targetLineWeight === 'thin')
    ) {
      flag = 'style-mismatch';
      reason = `линии ${row.lineWeight}, в книге чаще ${targetLineWeight}`;
    }
    return { ...row, complexity, flag, reason };
  });
}

async function nameSubject(file: string, fallback: string) {
  try {
    const preview = await sharp(await loadRaster(file))
      .resize(640, 840, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    const reply = await visionChat(
      'Label one kids coloring page. JSON only: {"subject":"1-5 English words Title Case"}. No brands.',
      'Main subject?',
      preview,
    );
    const json = extractJson(reply);
    const subject = String(json.subject ?? '')
      .replace(/['"]/g, '')
      .trim()
      .slice(0, 60);
    return subject || fallback;
  } catch {
    return fallback;
  }
}

function redrawOutPath(outDir: string, row: AuditScore) {
  const base = path.basename(row.file, path.extname(row.file));
  return path.join(outDir, `${String(row.index).padStart(2, '0')}-${base}.png`);
}

async function existingRedrawIndexes(outDir: string) {
  try {
    const names = await fs.readdir(outDir);
    const indexes = new Set<number>();
    for (const name of names) {
      const match = name.match(/^(\d+)-.+\.png$/i);
      if (match) indexes.add(Number(match[1]));
    }
    return indexes;
  } catch {
    return new Set<number>();
  }
}

/** Map index → full path of redraw PNG in an audit folder. */
async function loadOverrideMap(overridesDir: string) {
  const map = new Map<number, string>();
  try {
    const root = path.resolve(overridesDir);
    for (const name of await fs.readdir(root)) {
      const match = name.match(/^(\d+)-.+\.(png|jpg|jpeg|webp)$/i);
      if (!match) continue;
      map.set(Number(match[1]), path.join(root, name));
    }
  } catch {
    // none
  }
  return map;
}

function parseSelectTokens(select: string) {
  return select
    .split(/[,;\n]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/** Audit outputs look like `47-striped-mitten.png` — ignore if dropped into the book folder. */
export function isStrayRedrawFilename(name: string) {
  return /^\d{2,}-/.test(path.basename(name));
}

function pageStem(file: string) {
  return path.basename(file).toLowerCase().replace(/\.[^.]+$/, '');
}

/** Match "41", "#41", "striped-mitten", "santa-claus.png" — exact name only, no fuzzy includes. */
export function resolveSelect(pages: KdpPage[], select: string): AuditScore[] {
  const tokens = parseSelectTokens(select);
  if (!tokens.length) return [];
  const picked: AuditScore[] = [];
  const seen = new Set<number>();
  for (const token of tokens) {
    const asNum = token.replace(/^#/, '');
    if (/^\d+$/.test(asNum)) {
      const index = Number(asNum);
      const page = pages[index - 1];
      if (!page) throw new Error(`Нет страницы #${index} (в книге ${pages.length}).`);
      if (isStrayRedrawFilename(page.file)) {
        throw new Error(
          `#${index} сейчас указывает на файл-замену «${path.basename(page.file)}». Убери из папки книги файлы вида 47-name.png и выбери по точному имени оригинала.`,
        );
      }
      if (seen.has(index)) continue;
      seen.add(index);
      console.log(`Выбрано по номеру: #${index} → ${path.basename(page.file)}`);
      picked.push({
        index,
        file: page.file,
        basename: path.basename(page.file),
        subject: page.caption || subjectFromFilename(page.file),
        complexity: 3,
        inkScore: 0,
        lineWeight: 'medium',
        styleTag: 'manual',
        note: 'manual select',
        flag: 'style-mismatch',
        reason: 'выбрано вручную',
      });
      continue;
    }
    const needleBase = path.basename(token.toLowerCase().replace(/\\/g, '/'));
    const needleStem = needleBase.replace(/\.[^.]+$/, '');
    const matches = pages
      .map((page, i) => ({ page, index: i + 1 }))
      .filter(({ page }) => {
        if (isStrayRedrawFilename(page.file)) return false;
        const base = path.basename(page.file).toLowerCase();
        const stem = pageStem(page.file);
        return base === needleBase || stem === needleStem;
      });
    if (!matches.length) {
      const close = pages
        .filter((page) => !isStrayRedrawFilename(page.file))
        .map((page, i) => ({ index: i + 1, name: path.basename(page.file) }))
        .filter((row) => pageStem(row.name).includes(needleStem) || needleStem.includes(pageStem(row.name)))
        .slice(0, 8);
      const hint = close.length
        ? ` Похожие: ${close.map((row) => `#${row.index} ${row.name}`).join(', ')}`
        : '';
      throw new Error(`Не нашла точное имя «${token}». Пиши как файл: Untitled-2-06 или Untitled-2-06.png.${hint}`);
    }
    if (matches.length > 1) {
      throw new Error(
        `«${token}» подходит к нескольким: ${matches.map((m) => `#${m.index} ${path.basename(m.page.file)}`).join(', ')}`,
      );
    }
    const hit = matches[0]!;
    if (seen.has(hit.index)) continue;
    seen.add(hit.index);
    console.log(`Выбрано по имени «${token}»: #${hit.index} → ${path.basename(hit.page.file)} (${hit.page.file})`);
    picked.push({
      index: hit.index,
      file: hit.page.file,
      basename: path.basename(hit.page.file),
      subject: hit.page.caption || subjectFromFilename(hit.page.file),
      complexity: 3,
      inkScore: 0,
      lineWeight: 'medium',
      styleTag: 'manual',
      note: 'manual select',
      flag: 'style-mismatch',
      reason: 'выбрано вручную',
    });
  }
  return picked;
}

async function listExtraImages(extraFolder: string) {
  const root = path.resolve(extraFolder);
  const names = (await fs.readdir(root)).filter((name) =>
    /\.(png|jpg|jpeg|webp|svg)$/i.test(name),
  );
  if (!names.length) throw new Error(`В папке нет картинок: ${root}`);
  return names
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name, i) => ({
      index: 9000 + i + 1,
      file: path.join(root, name),
      basename: name,
      subject: subjectFromFilename(name),
      complexity: 3,
      inkScore: 0,
      lineWeight: 'medium' as const,
      styleTag: 'extra',
      note: 'extra folder',
      flag: 'style-mismatch' as const,
      reason: 'из доп. папки',
    }));
}

async function redrawFlagged(
  flagged: AuditScore[],
  options: {
    outDir: string;
    difficulty: LineDifficulty;
    age: string;
    styleGuide: string;
    lineWeight: AuditScore['lineWeight'];
    styleHint?: string;
    skipIndexes?: Set<number>;
  },
) {
  const weightLine =
    options.lineWeight === 'thick'
      ? 'Extra-thick even outlines, bold crayon-friendly lines.'
      : options.lineWeight === 'thin'
        ? 'Clean medium outlines, still printable (not hairline).'
        : 'Thick even closed outlines, bold-and-easy coloring-page look.';
  const style = [
    options.styleHint?.trim() ||
      `Cute consistent bold-and-easy kids coloring-book line art (${options.styleGuide}).`,
    weightLine,
    'One clear subject or a simple cozy scene matching the book average — not a tiny single object and not a crowded factory.',
    'Pure white background, solid black outlines only, no shading, no text, no frame.',
  ].join(' ');

  const results: { index: number; basename: string; outFile: string; subject: string; skipped?: boolean }[] = [];
  const todo = flagged.filter((row) => !options.skipIndexes?.has(row.index));
  const skipped = flagged.length - todo.length;
  if (skipped) console.log(`Уже готово, пропускаю: ${skipped}. Осталось нарисовать: ${todo.length}.`);

  for (const [i, row] of todo.entries()) {
    const outFile =
      row.index >= 9000
        ? path.join(
            options.outDir,
            `extra-${String(row.index - 9000).padStart(2, '0')}-${path.basename(row.file, path.extname(row.file))}.png`,
          )
        : redrawOutPath(options.outDir, row);
    console.log(`перерисовка ${i + 1}/${todo.length}: #${row.index} ${row.basename} (${row.flag})`);
    try {
      // Prefer naming from the current file (override/extra), so a redo matches what you see.
      const subject = await nameSubject(row.file, row.subject || subjectFromFilename(row.file));
      const prompt = coloringPrompt(style, subject, options.difficulty, options.age);
      const raw = await generateColoringPage(prompt);
      const print = await fitPortrait(raw);
      await fs.writeFile(outFile, print);
      results.push({ index: row.index, basename: row.basename, outFile, subject });
      console.log(`  → ${outFile}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  ошибка на #${row.index}: ${message}`);
      console.log('Можно снова нажать перерисовку — готовые файлы не перерисую, продолжу с места ошибки.');
      throw error;
    }
  }

  // Include already-existing redraws in the final list.
  for (const row of flagged) {
    if (!options.skipIndexes?.has(row.index)) continue;
    results.push({
      index: row.index,
      basename: row.basename,
      outFile: redrawOutPath(options.outDir, row),
      subject: row.subject,
      skipped: true,
    });
  }
  results.sort((a, b) => a.index - b.index);
  return results;
}

/**
 * Audit a KDP source folder for complexity/style consistency.
 * Complexity comes from local ink/edge density (reliable for mitten vs busy scene).
 * Vision is only used when redrawing (to name the subject).
 */
export async function auditKdpFolder(options: AuditOptions): Promise<AuditReport> {
  loadEnv();
  const folder = path.resolve(options.folder.trim());
  let pages =
    options.pages?.length && options.pages.every((page) => page.file)
      ? options.pages
      : await listKdpPages(folder);
  // If redraws were copied into the book folder (01-foo.png), they shift numbers — drop them.
  const beforeFilter = pages.length;
  pages = pages.filter((page) => !isStrayRedrawFilename(page.file));
  if (pages.length !== beforeFilter) {
    console.log(
      `Пропустила ${beforeFilter - pages.length} файлов-замен вида 47-name.png внутри папки книги (они сбивают номера).`,
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = options.resumeDir?.trim()
    ? path.resolve(options.resumeDir.trim())
    : path.join(factoryRoot, 'out', 'kdp', 'audit', path.basename(folder) || 'book', stamp);
  await fs.mkdir(outDir, { recursive: true });

  const overridesDir = (options.overridesDir || options.resumeDir || '').trim();
  const overrides = overridesDir ? await loadOverrideMap(overridesDir) : new Map<number, string>();
  const manualSelect = (options.select || '').trim();
  const extraFolder = (options.extraFolder || '').trim();
  const overwrite = Boolean(options.overwrite) || Boolean(manualSelect) || Boolean(extraFolder);
  const already = options.redraw && !overwrite ? await existingRedrawIndexes(outDir) : new Set<number>();

  console.log(`Аудит стиля: ${pages.length} картинок из ${folder}`);
  if (overrides.size) {
    console.log(`Учитываю замены из ${overridesDir}: ${overrides.size} PNG (повторная проверка после правок)`);
  }
  if (options.resumeDir) console.log(`Папка результата: ${outDir}`);
  console.log('Считаю плотность линий на каждой странице (варежка vs фабрика эльфов)...');

  const measured: Omit<AuditScore, 'flag' | 'reason' | 'complexity'>[] = [];
  for (const [index, page] of pages.entries()) {
    const pageIndex = index + 1;
    const overrideFile = overrides.get(pageIndex);
    const sourceFile = overrideFile || page.file;
    const local = await localInkScore(sourceFile);
    const subject = page.caption?.trim() || subjectFromFilename(page.file);
    measured.push({
      index: pageIndex,
      file: sourceFile,
      basename: path.basename(page.file),
      subject,
      inkScore: local.score,
      lineWeight: local.lineWeight,
      styleTag: overrideFile ? 'override' : 'local-ink',
      note: `${overrideFile ? 'redraw+ ' : ''}ink=${local.ink.toFixed(3)} edge=${local.edge.toFixed(3)} stroke≈${local.avgStroke.toFixed(1)}`,
    });
    console.log(
      `  #${pageIndex} ${path.basename(page.file)}${overrideFile ? ' [замена]' : ''} → ink ${local.score.toFixed(1)} · линии ${local.lineWeight}`,
    );
  }

  const medianInk = median(measured.map((row) => row.inkScore));
  const complexities = relativeComplexity(measured.map((row) => row.inkScore));
  const targetLineWeight = mode(
    measured.map((row) => row.lineWeight),
    'medium',
  );
  const targetComplexity = median(complexities);
  const targetDifficulty = difficultyFromComplexity(targetComplexity);
  const styleGuide = 'bold easy cozy winter line art';
  const scores = flagByInk(measured, complexities, medianInk, targetLineWeight);
  let flagged = scores.filter((row) => row.flag !== 'ok');

  console.log('');
  console.log(
    `Цель книги: медиана ink ${medianInk.toFixed(1)}, сложность ~${targetComplexity.toFixed(1)} (${targetDifficulty}), линии чаще ${targetLineWeight}`,
  );
  if (!flagged.length) {
    console.log('Выбивающихся по плотности почти нет.');
  } else {
    console.log(`Выбиваются ${flagged.length} из ${scores.length}:`);
    const simple = flagged.filter((row) => row.flag === 'too-simple');
    const complex = flagged.filter((row) => row.flag === 'too-complex');
    const style = flagged.filter((row) => row.flag === 'style-mismatch');
    if (simple.length) {
      console.log(`  слишком простые (${simple.length}): ${simple.map((row) => `#${row.index}`).join(', ')}`);
      for (const row of simple) console.log(`    #${row.index} ${row.basename} — ${row.reason}`);
    }
    if (complex.length) {
      console.log(`  слишком сложные (${complex.length}): ${complex.map((row) => `#${row.index}`).join(', ')}`);
      for (const row of complex) console.log(`    #${row.index} ${row.basename} — ${row.reason}`);
    }
    if (style.length) {
      console.log(`  другие линии (${style.length}): ${style.map((row) => `#${row.index}`).join(', ')}`);
      for (const row of style) console.log(`    #${row.index} ${row.basename} — ${row.reason}`);
    }
  }

  // Manual / extra targets replace the auto-flagged list for redraw.
  let redrawTargets = flagged;
  if (manualSelect) {
    // Use the exact original file the user named — do NOT swap to an override PNG
    // (that was redrawing 47-striped-mitten when the book folder contained that copy).
    redrawTargets = resolveSelect(pages, manualSelect);
    console.log(
      `Ручной список: перерисую ${redrawTargets.length}: ${redrawTargets
        .map((row) => `#${row.index} ${row.basename}`)
        .join(', ')}`,
    );
  }
  if (extraFolder) {
    const extras = await listExtraImages(extraFolder);
    console.log(`Доп. папка: ${extras.length} картинок → перерисовка в стиле книги`);
    redrawTargets = [...redrawTargets, ...extras];
  }

  let redraws: Awaited<ReturnType<typeof redrawFlagged>> = [];
  const shouldRedraw = Boolean(options.redraw || manualSelect || extraFolder);
  if (shouldRedraw && redrawTargets.length) {
    console.log('');
    console.log(`Перерисовываю платной моделью → ${outDir}${overwrite ? ' (с перезаписью)' : ''}`);
    for (const row of redrawTargets) {
      if (!overwrite && already.has(row.index)) {
        console.log(`  тема #${row.index}: уже есть файл, пропускаю`);
        continue;
      }
      // Subject filled inside redrawFlagged via vision on current file.
      console.log(`  в очереди #${row.index}: ${row.basename}`);
    }
    redraws = await redrawFlagged(redrawTargets, {
      outDir,
      difficulty: targetDifficulty,
      age: options.age || '3-4',
      styleGuide,
      lineWeight: targetLineWeight,
      styleHint: options.styleHint,
      skipIndexes: overwrite ? new Set() : already,
    });
    console.log('');
    console.log('Что заменить в книге (оригиналы не трогала):');
    for (const item of redraws) {
      console.log(
        `  #${item.index} (${item.basename}) → ${item.outFile}${item.skipped ? ' [уже было]' : ''}`,
      );
    }
  } else if (flagged.length && !manualSelect && !extraFolder) {
    console.log('');
    console.log('Перерисовку не запускала. Включи галочку, укажи номера, или доп. папку.');
  }

  const report = {
    folder,
    targetComplexity,
    targetDifficulty,
    targetLineWeight,
    styleGuide,
    medianInk,
    scores,
    flagged,
    redraws,
    outDir,
  };
  const reportFile = path.join(outDir, 'report.json');
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2), 'utf8');
  const summaryFile = path.join(outDir, 'replace-list.txt');
  const lines = [
    `Медиана плотности: ${medianInk.toFixed(1)} · цель сложности ~${targetComplexity.toFixed(1)} (${targetDifficulty}) · линии ${targetLineWeight}`,
    `Выбиваются: ${flagged.length} из ${scores.length}`,
    '',
    ...flagged.map((row) => {
      const redraw = redraws.find((item) => item.index === row.index);
      return `#${row.index} ${row.basename} — ${row.flag}: ${row.reason}${redraw ? `\n  NEW: ${redraw.outFile}` : ''}`;
    }),
  ];
  await fs.writeFile(summaryFile, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Отчёт: ${reportFile}`);
  console.log(`Список: ${summaryFile}`);

  return {
    folder,
    targetComplexity,
    targetDifficulty,
    targetLineWeight,
    styleGuide,
    medianInk,
    scores,
    flagged,
    outDir,
    reportFile,
  };
}
