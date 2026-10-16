import fs from 'node:fs/promises';
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

type ExtractedImage = { bytes: Buffer; width: number; height: number; area: number };

async function imageFromStream(obj: PDFRawStream): Promise<ExtractedImage | null> {
  const dict = obj.dict;
  const width = Number(dict.lookup(PDFName.of('Width')));
  const height = Number(dict.lookup(PDFName.of('Height')));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 32 || height < 32) {
    return null;
  }

  const filter = dict.lookup(PDFName.of('Filter'));
  const raw = filterIsJpeg(filter) ? Buffer.from(obj.getContents()) : streamBytes(obj);

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
    if (raw.length < width * height * channels) return null;
    try {
      bytes = await sharp(raw.subarray(0, width * height * channels), {
        raw: { width, height, channels: channels as 1 | 3 },
      })
        .png()
        .toBuffer();
    } catch {
      return null;
    }
  }

  return { bytes, width, height, area: width * height };
}

/**
 * Walk page (and nested Form XObject) Resources for Image XObjects.
 * Embedded PDF covers via pdf-lib `drawPage` are Forms wrapping the original images.
 */
async function scanXObjectImages(
  xobjects: PDFDict,
  context: PDFDocument['context'],
  best: { current: ExtractedImage | null },
  seen: Set<PDFRawStream>,
) {
  for (const key of xobjects.keys()) {
    const obj = resolveRef(context, xobjects.get(key));
    if (!(obj instanceof PDFRawStream) || seen.has(obj)) continue;
    seen.add(obj);

    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (!(subtype instanceof PDFName)) continue;
    const kind = subtype.decodeText();

    if (kind === 'Image') {
      const image = await imageFromStream(obj);
      if (image && (!best.current || image.area > best.current.area)) {
        best.current = image;
      }
      continue;
    }

    if (kind === 'Form') {
      const formResources = resolveRef(context, obj.dict.get(PDFName.of('Resources')));
      if (!(formResources instanceof PDFDict)) continue;
      const nested = resolveRef(context, formResources.get(PDFName.of('XObject')));
      if (nested instanceof PDFDict) {
        await scanXObjectImages(nested, context, best, seen);
      }
    }
  }
}

/**
 * Largest embedded bitmap on a page (factory art pages are one full-page JPEG;
 * PDF covers embedded as Form XObjects are searched recursively).
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

  const best: { current: ExtractedImage | null } = { current: null };
  await scanXObjectImages(xobjects, context, best, new Set());
  return best.current
    ? { bytes: best.current.bytes, width: best.current.width, height: best.current.height }
    : null;
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
 * First page of a cover PDF → download/kdp JPEG (extracts largest image XObject).
 * Returns null if the page has no extractable bitmap (caller may embed vectors).
 */
export async function encodePdfFirstPageImage(
  file: string,
  preset: PdfEncodePreset = 'download',
): Promise<Buffer | null> {
  const bytes = await fs.readFile(file);
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (src.getPageCount() < 1) return null;
  return recompressPageImage(src.getPage(0)!, src.context, preset);
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
