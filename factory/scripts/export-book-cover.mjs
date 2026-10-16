import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFRef, PDFArray, decodePDFRawStream } from 'pdf-lib';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfPath = process.argv[2];
const outPath = process.argv[3];
if (!pdfPath || !outPath) {
  console.error('Usage: node export-book-cover.mjs <cover.pdf> <out.png>');
  process.exit(1);
}

function resolveRef(context, ref) {
  return ref instanceof PDFRef ? context.lookup(ref) : ref;
}

function filterIsJpeg(filter) {
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

function streamBytes(stream) {
  try {
    return Buffer.from(decodePDFRawStream(stream).decode());
  } catch {
    return Buffer.from(stream.getContents());
  }
}

const bytes = fs.readFileSync(pdfPath);
const doc = await PDFDocument.load(bytes);
const page = doc.getPage(0);
const context = doc.context;
const resources = resolveRef(context, page.node.get(PDFName.of('Resources')));
if (!(resources instanceof PDFDict)) throw new Error('No Resources');
const xobjects = resolveRef(context, resources.get(PDFName.of('XObject')));
if (!(xobjects instanceof PDFDict)) throw new Error('No XObject');

let best = null;
for (const key of xobjects.keys()) {
  const obj = resolveRef(context, xobjects.get(key));
  if (!(obj instanceof PDFRawStream)) continue;
  const dict = obj.dict;
  const subtype = dict.get(PDFName.of('Subtype'));
  if (!(subtype instanceof PDFName) || subtype.decodeText() !== 'Image') continue;
  const width = Number(dict.lookup(PDFName.of('Width')));
  const height = Number(dict.lookup(PDFName.of('Height')));
  if (!width || !height) continue;
  const area = width * height;
  if (best && area <= best.area) continue;
  const filter = dict.lookup(PDFName.of('Filter'));
  const raw = filterIsJpeg(filter) ? Buffer.from(obj.getContents()) : streamBytes(obj);
  best = { bytes: raw, width, height, area, jpeg: filterIsJpeg(filter) };
}

if (!best) throw new Error('No image XObject in cover PDF');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
await sharp(best.bytes).png().toFile(outPath);
const meta = await sharp(outPath).metadata();
console.log(`Wrote ${outPath} (${meta.width}x${meta.height}, from ${best.width}x${best.height})`);
