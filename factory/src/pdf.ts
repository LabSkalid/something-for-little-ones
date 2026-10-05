import { PDFDocument } from 'pdf-lib';

const pages = {
  letter: [612, 792],
  a4: [595.28, 841.89],
} as const;

export async function pngToPdf(png: Buffer, format: keyof typeof pages, title: string, author: string) {
  const [width, height] = pages[format];
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor(author);
  const page = doc.addPage([width, height]);
  const image = await doc.embedPng(png);
  const margin = 28;
  const maxWidth = width - margin * 2;
  const maxHeight = height - margin * 2;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  page.drawImage(image, {
    x: (width - drawWidth) / 2,
    y: (height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  });
  return doc.save();
}
