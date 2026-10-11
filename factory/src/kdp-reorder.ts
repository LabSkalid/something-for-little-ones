import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

export type ReorderOptions = {
  pdfFile: string;
  /** 1-based page numbers in the desired final order. Must list every page once. */
  order?: number[];
  /** Swap two 1-based page indexes. */
  swap?: [number, number];
  /**
   * With blank backs: also swap the following page (оборот).
   * So swap 5↔9 also swaps 6↔10.
   */
  withBacks?: boolean;
  /** Move 1-based page `from` so it becomes position `to` (1-based). */
  move?: { from: number; to: number };
  /** Output path. Default: same name with `-reordered` before .pdf */
  outFile?: string;
};

function assertPages(count: number, indexes: number[], label: string) {
  for (const n of indexes) {
    if (!Number.isInteger(n) || n < 1 || n > count) {
      throw new Error(`${label}: страница ${n} вне диапазона 1…${count}.`);
    }
  }
}

function buildSwapOrder(count: number, a: number, b: number, withBacks: boolean) {
  if (a === b) throw new Error('Для обмена нужны два разных номера страниц.');
  const order = Array.from({ length: count }, (_, i) => i + 1);
  const swapOne = (x: number, y: number) => {
    const ix = order.indexOf(x);
    const iy = order.indexOf(y);
    if (ix < 0 || iy < 0) throw new Error(`Не найдены страницы ${x} и ${y}.`);
    const tmp = order[ix]!;
    order[ix] = order[iy]!;
    order[iy] = tmp;
  };
  swapOne(a, b);
  if (withBacks) {
    if (a + 1 > count || b + 1 > count) {
      throw new Error('Нельзя взять оборот: одна из страниц последняя в PDF.');
    }
    if (a + 1 === b || b + 1 === a) {
      throw new Error('Страницы соседние — обмен с оборотами пересекается. Укажи рисунки через один.');
    }
    swapOne(a + 1, b + 1);
  }
  return order;
}

function buildMoveOrder(count: number, from: number, to: number) {
  if (from === to) throw new Error('Страница уже на этой позиции.');
  const order = Array.from({ length: count }, (_, i) => i + 1);
  const [item] = order.splice(from - 1, 1);
  order.splice(to - 1, 0, item!);
  return order;
}

function defaultOutFile(pdfFile: string) {
  const ext = path.extname(pdfFile);
  const base = pdfFile.slice(0, -ext.length);
  return `${base}-reordered${ext || '.pdf'}`;
}

/**
 * Reorder pages in an existing KDP (or any) PDF. Does not regenerate art —
 * only shuffles page objects. Saves a new file by default.
 */
export async function reorderKdpPdf(options: ReorderOptions) {
  const pdfFile = path.resolve(options.pdfFile.trim());
  const bytes = await fs.readFile(pdfFile);
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const count = src.getPageCount();
  if (count < 2) throw new Error('В PDF меньше двух страниц — менять нечего.');

  let order: number[];
  if (options.order?.length) {
    order = options.order.map((n) => Number(n));
    if (order.length !== count) {
      throw new Error(`В порядке должно быть ровно ${count} номеров (сейчас ${order.length}).`);
    }
    assertPages(count, order, 'Порядок');
    const set = new Set(order);
    if (set.size !== count) throw new Error('В порядке есть повторы или пропуски страниц.');
  } else if (options.swap) {
    const [a, b] = options.swap.map((n) => Number(n)) as [number, number];
    assertPages(count, [a, b], 'Обмен');
    order = buildSwapOrder(count, a, b, Boolean(options.withBacks));
  } else if (options.move) {
    const from = Number(options.move.from);
    const to = Number(options.move.to);
    assertPages(count, [from, to], 'Перемещение');
    order = buildMoveOrder(count, from, to);
  } else {
    throw new Error('Укажите обмен (swap), перемещение (move) или полный новый порядок.');
  }

  console.log(`PDF: ${pdfFile} (${count} стр.)`);
  console.log(`Новый порядок: ${order.join(', ')}`);

  const out = await PDFDocument.create();
  const copied = await out.copyPages(
    src,
    order.map((n) => n - 1),
  );
  for (const page of copied) out.addPage(page);

  // Keep title if present
  const title = src.getTitle();
  if (title) out.setTitle(title);
  const author = src.getAuthor();
  if (author) out.setAuthor(author);

  const outFile = path.resolve(options.outFile?.trim() || defaultOutFile(pdfFile));
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, await out.save({ useObjectStreams: false }));
  console.log(`Сохранено: ${outFile}`);
  return { outFile, pages: count, order };
}
