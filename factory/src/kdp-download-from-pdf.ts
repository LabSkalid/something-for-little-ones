import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  type PDFPage,
} from 'pdf-lib';
import { addLetterImagePage, type PdfEncodePreset } from './kdp-book.ts';
import { appendPageLight } from './kdp-pdf-images.ts';

export type DownloadFromKdpOptions = {
  /** Existing Amazon KDP interior PDF (with blank backs). */
  pdfFile: string;
  /** Full-page front cover (PNG/JPG/SVG/PDF), 8.5×11. Optional. */
  frontCover?: string;
  /** Full-page back cover (PNG/JPG/SVG/PDF), 8.5×11. Optional. */
  backCover?: string;
  /** Output path. Default: next to source as `…-download.pdf`. */
  outFile?: string;
  /**
   * Re-encode full-page images lighter for download size.
   * Default `download`. Pass `kdp` only if you need Amazon-grade weight.
   */
  encodePreset?: PdfEncodePreset;
};

/** Operators that paint something visible (text, images, paths, inline images). */
const PAINT_OP =
  /\b(?:Do|Tj|TJ|'|"|f\*|f|F|B\*|B|b\*|b|S|s|sh|BI|ID|d0|d1)\b/;

function resolveRef(context: PDFDocument['context'], ref: unknown) {
  return ref instanceof PDFRef ? context.lookup(ref) : ref;
}

function readContentBytes(page: PDFPage, context: PDFDocument['context']): Buffer {
  const contents = page.node.get(PDFName.of('Contents'));
  if (!contents) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  const pushStream = (obj: unknown) => {
    const stream = resolveRef(context, obj);
    if (!(stream instanceof PDFRawStream)) return;
    try {
      chunks.push(Buffer.from(decodePDFRawStream(stream).decode()));
    } catch {
      chunks.push(Buffer.from(stream.getContents()));
    }
  };

  const resolved = resolveRef(context, contents);
  if (resolved instanceof PDFArray) {
    for (let i = 0; i < resolved.size(); i++) pushStream(resolved.get(i));
  } else {
    pushStream(resolved);
  }
  return Buffer.concat(chunks);
}

function resourceDictHasEntries(
  context: PDFDocument['context'],
  resources: unknown,
  key: string,
): boolean {
  if (!resources) return false;
  const dict = resolveRef(context, resources);
  if (!(dict instanceof PDFDict)) return false;
  const sub = dict.get(PDFName.of(key));
  if (!sub) return false;
  const subDict = resolveRef(context, sub);
  if (!(subDict instanceof PDFDict)) return false;
  return [...subDict.keys()].length > 0;
}

/**
 * True for factory-style empty backs (`doc.addPage` with nothing drawn)
 * and other pages with no images/text/path paint ops.
 * Title, copyright, art, and real covers stay (they have content or XObjects).
 */
export function isBlankPdfPage(page: PDFPage, context: PDFDocument['context']): boolean {
  if (resourceDictHasEntries(context, page.node.get(PDFName.of('Resources')), 'XObject')) {
    return false;
  }

  const content = readContentBytes(page, context);
  if (!content.length) return true;

  const text = content.toString('latin1');
  if (PAINT_OP.test(text)) return false;

  // Only graphics-state / whitespace — treat as blank.
  return true;
}

function defaultDownloadOut(pdfFile: string) {
  const ext = path.extname(pdfFile) || '.pdf';
  const base = path.basename(pdfFile, ext);
  const stem = /-download$/i.test(base) ? base : `${base}-download`;
  return path.join(path.dirname(pdfFile), `${stem}${ext}`);
}

/**
 * Build a digital-download PDF from an existing KDP interior:
 * drop blank/empty pages, optionally add front/back covers. No art folder needed.
 */
export async function buildDownloadPdfFromKdp(options: DownloadFromKdpOptions) {
  const pdfFile = path.resolve((options.pdfFile ?? '').trim());
  if (!pdfFile) throw new Error('Укажите путь к готовому KDP PDF.');

  const frontCover = (options.frontCover ?? '').trim();
  const backCover = (options.backCover ?? '').trim();
  const encodePreset: PdfEncodePreset = options.encodePreset ?? 'download';

  const bytes = await fs.readFile(pdfFile);
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const totalIn = src.getPageCount();
  if (!totalIn) throw new Error('В PDF нет страниц.');

  const keepIndexes: number[] = [];
  const removedPages: number[] = [];
  const pages = src.getPages();
  for (let i = 0; i < totalIn; i++) {
    if (isBlankPdfPage(pages[i]!, src.context)) {
      removedPages.push(i + 1);
    } else {
      keepIndexes.push(i);
    }
  }

  if (!keepIndexes.length) {
    throw new Error('Все страницы выглядят пустыми — проверьте исходный PDF.');
  }

  console.log(`KDP PDF → скачивание: ${pdfFile}`);
  console.log(`Было ${totalIn} стр.: оставляю ${keepIndexes.length}, убираю пустые: ${removedPages.length}`);
  if (removedPages.length) {
    const preview =
      removedPages.length <= 24
        ? removedPages.join(', ')
        : `${removedPages.slice(0, 20).join(', ')}… (+${removedPages.length - 20})`;
    console.log(`Пустые страницы (номера в исходнике): ${preview}`);
  }
  if (frontCover) console.log(`Обложка (лицо): ${path.basename(frontCover)}`);
  if (backCover) console.log(`Обложка (зад): ${path.basename(backCover)}`);
  console.log(
    encodePreset === 'download'
      ? 'Сжимаю картинки: ~200 dpi, grayscale JPEG q75 (удобно качать и печатать дома)'
      : 'Картинки без доп. сжатия (режим kdp)',
  );

  const out = await PDFDocument.create();
  const title = src.getTitle();
  if (title) out.setTitle(title);
  const author = src.getAuthor();
  if (author) out.setAuthor(author);

  if (frontCover) await addLetterImagePage(out, frontCover, encodePreset);

  let rebuilt = 0;
  let copied = 0;
  for (const index of keepIndexes) {
    const kind = await appendPageLight(out, src, index, encodePreset);
    if (kind === 'image') rebuilt += 1;
    else copied += 1;
    if ((rebuilt + copied) % 10 === 0 || rebuilt + copied === keepIndexes.length) {
      console.log(`Страницы: ${rebuilt + copied}/${keepIndexes.length} (сжато ${rebuilt}, как есть ${copied})`);
    }
  }

  if (backCover) await addLetterImagePage(out, backCover, encodePreset);

  const outFile = path.resolve(options.outFile?.trim() || defaultDownloadOut(pdfFile));
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  // Avoid writing onto the file we still have open as `src` bytes — use temp if same path.
  const samePath = path.resolve(pdfFile) === outFile;
  const writePath = samePath ? `${outFile}.tmp.pdf` : outFile;
  await fs.writeFile(writePath, await out.save({ useObjectStreams: false }));
  if (samePath) {
    await fs.rename(writePath, outFile);
  }

  const totalOut = out.getPageCount();
  const inMb = (bytes.length / (1024 * 1024)).toFixed(1);
  const outStat = await fs.stat(outFile);
  const outMb = (outStat.size / (1024 * 1024)).toFixed(1);
  console.log(
    `Готово: ${totalOut} стр. (сохранено ${keepIndexes.length}` +
      (frontCover ? ' + лицо' : '') +
      (backCover ? ' + зад' : '') +
      `, убрано пустых ${removedPages.length}; сжато картинок ${rebuilt})`,
  );
  console.log(`Размер: ${inMb} MB → ${outMb} MB`);
  console.log(`Файл: ${outFile}`);
  console.log('PDF для скачивания / печати дома: 8.5×11, без пустых оборотов. Папка с рисунками не нужна.');

  return {
    outFile,
    pagesIn: totalIn,
    pagesOut: totalOut,
    kept: keepIndexes.length,
    removed: removedPages.length,
    removedPages,
    rebuilt,
    sizeIn: bytes.length,
    sizeOut: outStat.size,
  };
}
