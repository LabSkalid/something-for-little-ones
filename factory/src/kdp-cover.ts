import fs from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { factoryRoot } from './paths.ts';

/** KDP black & white interior, white paper — inches per page. */
const SPINE_PER_PAGE_IN = 0.002252;
const BLEED_IN = 0.125;
const TRIM_W_IN = 8.5;
const TRIM_H_IN = 11;
const DPI = 300;
const SAFE_IN = 0.25;
/** KDP barcode reserved box on back cover (inches). */
const BARCODE_W_IN = 2;
const BARCODE_H_IN = 1.2;

export type KdpCoverOptions = {
  /** Exact page count from the interior PDF (KDP uses this for spine). */
  pageCount: number;
  title?: string;
  /** How many empty picture slots on the front. Default 4. */
  slots?: number;
  outFile?: string;
};

export function estimateInteriorPages(options: {
  artCount: number;
  blankBacks?: boolean;
  frontMatter?: boolean;
}) {
  const art = Math.max(0, options.artCount);
  const perArt = options.blankBacks === false ? 1 : 2;
  let pages = (options.frontMatter === false ? 0 : 2) + art * perArt;
  if (pages % 2 === 1) pages += 1;
  return Math.max(24, pages);
}

export function coverSizeInches(pageCount: number) {
  const pages = Math.max(24, Math.round(pageCount));
  const spineIn = pages * SPINE_PER_PAGE_IN;
  const widthIn = BLEED_IN + TRIM_W_IN + spineIn + TRIM_W_IN + BLEED_IN;
  const heightIn = BLEED_IN + TRIM_H_IN + BLEED_IN;
  return {
    pages,
    spineIn,
    widthIn,
    heightIn,
    widthPx: Math.round(widthIn * DPI),
    heightPx: Math.round(heightIn * DPI),
    bleedPx: Math.round(BLEED_IN * DPI),
    trimWPx: Math.round(TRIM_W_IN * DPI),
    trimHPx: Math.round(TRIM_H_IN * DPI),
    spinePx: Math.round(spineIn * DPI),
    safePx: Math.round(SAFE_IN * DPI),
  };
}

function slugifyName(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'kdp-cover'
  );
}

function xml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Blank KDP paperback wrap (back + spine + front) at 300 dpi with guides
 * and empty picture slots on the front. Edit in Canva / Photopea / Photoshop,
 * then export PDF for KDP Cover.
 */
export async function buildKdpCoverTemplate(options: KdpCoverOptions) {
  const size = coverSizeInches(options.pageCount);
  const title = (options.title ?? '').trim() || 'Your Book Title';
  const slots = Math.min(6, Math.max(1, options.slots ?? 4));
  const outFile =
    options.outFile?.trim() ||
    path.join(factoryRoot, 'out', 'kdp', `${slugifyName(title)}-cover-template.png`);

  const { widthPx: W, heightPx: H, bleedPx: B, trimWPx: TW, spinePx: SP, safePx: S } = size;
  const backX = B;
  const spineX = B + TW;
  const frontX = B + TW + SP;

  // Front picture slots in a 2-column grid inside the safe area.
  const cols = slots <= 3 ? 1 : 2;
  const rows = Math.ceil(slots / cols);
  const frontInnerX = frontX + S;
  const frontInnerY = B + S;
  const frontInnerW = TW - S * 2;
  const frontInnerH = H - B * 2 - S * 2;
  const titleBand = Math.round(frontInnerH * 0.18);
  const gridTop = frontInnerY + titleBand;
  const gridH = frontInnerH - titleBand - Math.round(frontInnerH * 0.08);
  const gap = Math.round(Math.min(frontInnerW, gridH) * 0.04);
  const cellW = Math.floor((frontInnerW - gap * (cols - 1)) / cols);
  const cellH = Math.floor((gridH - gap * (rows - 1)) / rows);

  const slotRects: { x: number; y: number; w: number; h: number; label: string }[] = [];
  for (let i = 0; i < slots; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    slotRects.push({
      x: frontInnerX + col * (cellW + gap),
      y: gridTop + row * (cellH + gap),
      w: cellW,
      h: cellH,
      label: `Picture ${i + 1}`,
    });
  }

  const barcodeW = Math.round(BARCODE_W_IN * DPI);
  const barcodeH = Math.round(BARCODE_H_IN * DPI);
  const barcodeX = backX + TW - S - barcodeW;
  const barcodeY = H - B - S - barcodeH;

  const guides = slotRects
    .map(
      (slot) => `
    <rect x="${slot.x}" y="${slot.y}" width="${slot.w}" height="${slot.h}" fill="#f0f4f7" stroke="#1d7ad6" stroke-width="4" stroke-dasharray="14 10"/>
    <text x="${slot.x + slot.w / 2}" y="${slot.y + slot.h / 2}" text-anchor="middle" dominant-baseline="middle" font-family="Arial" font-size="36" fill="#5c676e">${xml(slot.label)}</text>`,
    )
    .join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <!-- bleed edge -->
  <rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#e8b4b4" stroke-width="2"/>
  <!-- trim / panel guides -->
  <line x1="${backX}" y1="${B}" x2="${backX}" y2="${H - B}" stroke="#cccccc" stroke-width="2" stroke-dasharray="8 8"/>
  <line x1="${spineX}" y1="${B}" x2="${spineX}" y2="${H - B}" stroke="#888888" stroke-width="3"/>
  <line x1="${frontX}" y1="${B}" x2="${frontX}" y2="${H - B}" stroke="#888888" stroke-width="3"/>
  <line x1="${W - B}" y1="${B}" x2="${W - B}" y2="${H - B}" stroke="#cccccc" stroke-width="2" stroke-dasharray="8 8"/>
  <line x1="${B}" y1="${B}" x2="${W - B}" y2="${B}" stroke="#cccccc" stroke-width="2" stroke-dasharray="8 8"/>
  <line x1="${B}" y1="${H - B}" x2="${W - B}" y2="${H - B}" stroke="#cccccc" stroke-width="2" stroke-dasharray="8 8"/>
  <!-- labels -->
  <text x="${backX + TW / 2}" y="${B + 48}" text-anchor="middle" font-family="Arial" font-size="40" fill="#9aa3a8">BACK COVER</text>
  <text x="${spineX + SP / 2}" y="${H / 2}" text-anchor="middle" font-family="Arial" font-size="${Math.max(14, Math.min(26, Math.max(10, SP - 6)))}" fill="#9aa3a8" transform="rotate(-90 ${spineX + SP / 2} ${H / 2})">SPINE</text>
  <text x="${frontX + TW / 2}" y="${B + 48}" text-anchor="middle" font-family="Arial" font-size="40" fill="#9aa3a8">FRONT COVER</text>
  <text x="${frontX + TW / 2}" y="${frontInnerY + titleBand * 0.55}" text-anchor="middle" font-family="Arial" font-size="52" fill="#c5ccd1">${xml(title)}</text>
  <text x="${frontX + TW / 2}" y="${frontInnerY + titleBand * 0.85}" text-anchor="middle" font-family="Arial" font-size="28" fill="#c5ccd1">replace with your title</text>
  ${guides}
  <!-- barcode keep-out -->
  <rect x="${barcodeX}" y="${barcodeY}" width="${barcodeW}" height="${barcodeH}" fill="#ffffff" stroke="#cc3333" stroke-width="3" stroke-dasharray="10 8"/>
  <text x="${barcodeX + barcodeW / 2}" y="${barcodeY + barcodeH / 2}" text-anchor="middle" dominant-baseline="middle" font-family="Arial" font-size="28" fill="#cc3333">KDP barcode — leave blank</text>
  <text x="${B + 24}" y="${H - 20}" font-family="Arial" font-size="22" fill="#b0b6bb">${size.pages} pages · white paper B&amp;W · ${size.widthIn.toFixed(3)}" × ${size.heightIn.toFixed(3)}" · 300 dpi · guides are not printed — delete before upload</text>
</svg>`;

  const overlay = Buffer.from(
    new Resvg(svg, {
      fitTo: { mode: 'width', value: W },
      font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
    })
      .render()
      .asPng(),
  );

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await sharp({
    create: { width: W, height: H, channels: 3, background: '#ffffff' },
  })
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toFile(outFile);

  console.log(`Шаблон обложки: ${outFile}`);
  console.log(
    `Размер ${size.widthIn.toFixed(3)}" × ${size.heightIn.toFixed(3)}" (${W}×${H} px @ 300 dpi), spine ${size.spineIn.toFixed(3)}" for ${size.pages} pages`,
  );
  console.log('Открой PNG в Canva / Photopea / Photoshop, замени плейсхолдеры, экспортируй PDF для KDP Cover.');
  console.log('Или скачай официальный шаблон: https://kdp.amazon.com/cover-calculator');
  return { outFile, ...size };
}
