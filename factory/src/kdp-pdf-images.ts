import sharp from 'sharp';
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
import {
  addEncodedLetterPage,
  encodeLetterForPdf,
  type PdfEncodePreset,
} from './kdp-book.ts';

function resolveRef(context: PDFDocument['context'], ref: unknown) {
  return ref instanceof PDFRef ? context.lookup(ref) : ref;
}

function filterIsJpeg(filter: unknown): boolean {
  if (!filter) return false;
  if (filter instanceof PDFName) return filter.decodeText() === 'DCTDecode';
  if (filter instanceof PDFArray) {
    for (let i = 0; i < filter.size(); i++) {
      const item = filter.get(i);
      if (item instanceof PDFName && item.decodeText() === 'DCTDecode') return true;
    }
  }
  return false;
}

function streamBytes(stream: PDFRawStream): Buffer {
  try {
    return Buffer.from(decodePDFRawStream(stream).decode());
  } catch {
    return Buffer.from(stream.getContents());
  }
}

/**
 * Largest embedded bitmap on a page (factory art pages are one full-page JPEG).
 * Returns raw image bytes Sharp can open (JPEG file or raw decoded Flate RGB/Gray).
 */
export async function extractLargestPageImage(
  page: PDFPage,
  context: PDFDocument['context'],
): Promise<{ bytes: Buffer; width: number; height: number } | null> {
  const resources = resolveRef(context, page.node.get(PDFName.of('Resources')));
  if (!(resources instanceof PDFDict)) return null;
  const xobjects = resolveRef(context, resources.get(PDFName.of('XObject')));
  if (!(xobjects instanceof PDFDict)) return null;

  let best: { bytes: Buffer; width: number; height: number; area: number } | null = null;

  for (const key of xobjects.keys()) {
    const obj = resolveRef(context, xobjects.get(key));
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    const subtype = dict.get(PDFName.of('Subtype'));
    if (!(subtype instanceof PDFName) || subtype.decodeText() !== 'Image') continue;

    const width = Number(dict.lookup(PDFName.of('Width')));
    const height = Number(dict.lookup(PDFName.of('Height')));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 32 || height < 32) continue;

    const area = width * height;
    if (best && area <= best.area) continue;

    const filter = dict.lookup(PDFName.of('Filter'));
    const raw = filterIsJpeg(filter)
      ? Buffer.from(obj.getContents())
      : streamBytes(obj);

    // Sharp opens JPEG/PNG; for Flate DeviceRGB try raw.
    let bytes = raw;
    if (!filterIsJpeg(filter)) {
      const colorSpace = dict.lookup(PDFName.of('ColorSpace'));
      const cs =
        colorSpace instanceof PDFName
          ? colorSpace.decodeText()
          : colorSpace instanceof PDFArray && colorSpace.get(0) instanceof PDFName
            ? (colorSpace.get(0) as PDFName).decodeText()
            : '';
      const channels = cs === 'DeviceGray' || cs === 'CalGray' ? 1 : 3;
      if (raw.length >= width * height * channels) {
        try {
          bytes = await sharp(raw.subarray(0, width * height * channels), {
            raw: { width, height, channels: channels as 1 | 3 },
          })
            .png()
            .toBuffer();
        } catch {
          continue;
        }
      } else {
        continue;
      }
    }

    best = { bytes, width, height, area };
  }

  return best ? { bytes: best.bytes, width: best.width, height: best.height } : null;
}

/** Re-encode a page's main image with download/kdp preset; null if no image. */
export async function recompressPageImage(
  page: PDFPage,
  context: PDFDocument['context'],
  preset: PdfEncodePreset = 'download',
): Promise<Buffer | null> {
  const image = await extractLargestPageImage(page, context);
  if (!image) return null;
  return encodeLetterForPdf(image.bytes, preset);
}

/**
 * Copy text-only pages as-is; rebuild image pages with lighter JPEG for download size.
 */
export async function appendPageLight(
  out: PDFDocument,
  src: PDFDocument,
  pageIndex: number,
  preset: PdfEncodePreset = 'download',
): Promise<'image' | 'copied'> {
  const page = src.getPage(pageIndex);
  const jpeg = await recompressPageImage(page, src.context, preset);
  if (jpeg) {
    await addEncodedLetterPage(out, jpeg);
    return 'image';
  }
  const [copied] = await out.copyPages(src, [pageIndex]);
  out.addPage(copied);
  return 'copied';
}
