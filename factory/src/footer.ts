import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { readSite } from './brand.ts';

const fontCandidates = [
  'C:/Windows/Fonts/georgia.ttf',
  'C:/Windows/Fonts/georgiab.ttf',
  'C:/Windows/Fonts/arial.ttf',
];

function xml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function footerHeight(width: number) {
  return Math.max(96, Math.round(width * 0.072));
}

function rowDarkRatio(
  data: Buffer,
  width: number,
  y: number,
  x0: number,
  x1: number,
  threshold = 200,
) {
  let dark = 0;
  const span = Math.max(1, x1 - x0);
  for (let x = x0; x < x1; x += 1) {
    if (data[y * width + x] < threshold) dark += 1;
  }
  return dark / span;
}

/**
 * Detect the site stamp band (thin rule + host + "FREE PRINTABLE…") at the bottom.
 * Must not confuse a stock picture frame's bottom edge with the site stamp.
 */
async function detectSiteFooterHeight(image: Buffer): Promise<number | null> {
  const meta = await sharp(image).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 240 || height < 240) return null;

  const expected = footerHeight(width);
  const candidates = [
    expected,
    Math.round(expected * 1.12),
    Math.round(width * 0.072),
    Math.max(96, Math.round(height * 0.075)),
    Math.max(96, Math.round(height * 0.09)),
  ];
  const seen = new Set<number>();

  for (const band of candidates) {
    if (seen.has(band)) continue;
    seen.add(band);
    if (band < 64 || band > Math.floor(height * 0.22)) continue;

    const { data, info } = await sharp(image)
      .extract({ left: 0, top: height - band, width, height: band })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const x0 = Math.floor(width * 0.18);
    const x1 = Math.floor(width * 0.82);
    const span = Math.max(1, x1 - x0);

    // Side columns stay mostly white on a site stamp; a picture frame paints them dark.
    let sideDark = 0;
    let sideTotal = 0;
    const sideW = Math.max(4, Math.floor(width * 0.04));
    for (let y = 0; y < info.height; y += 2) {
      for (let x = 0; x < sideW; x += 1) {
        if (data[y * info.width + x] < 120) sideDark += 1;
        if (data[y * info.width + (info.width - 1 - x)] < 120) sideDark += 1;
        sideTotal += 2;
      }
    }
    if (sideTotal && sideDark / sideTotal > 0.08) continue;

    let ruleY = -1;
    let ruleThickness = 0;
    const yRule0 = Math.floor(band * 0.04);
    const yRule1 = Math.floor(band * 0.38);
    for (let y = yRule0; y < yRule1; y += 1) {
      if (rowDarkRatio(data, info.width, y, x0, x1, 210) < 0.5) continue;
      let thickness = 1;
      while (
        y + thickness < yRule1 &&
        rowDarkRatio(data, info.width, y + thickness, x0, x1, 210) >= 0.35
      ) {
        thickness += 1;
      }
      // Site rule is a hairline (1–6px). Frame borders are thicker.
      if (thickness >= 1 && thickness <= 6) {
        ruleY = y;
        ruleThickness = thickness;
        break;
      }
    }
    if (ruleY < 0) continue;

    // Immediately under the rule: mostly white gap before the host text.
    const gapY0 = ruleY + ruleThickness + 1;
    const gapY1 = Math.min(info.height - 1, gapY0 + Math.max(4, Math.round(band * 0.12)));
    let gapDark = 0;
    let gapTotal = 0;
    for (let y = gapY0; y < gapY1; y += 1) {
      gapDark += rowDarkRatio(data, info.width, y, x0, x1, 200);
      gapTotal += 1;
    }
    if (!gapTotal || gapDark / gapTotal > 0.12) continue;

    let darkAll = 0;
    for (let i = 0; i < data.length; i += 1) if (data[i] < 200) darkAll += 1;
    const darkPct = darkAll / data.length;
    // Footer is sparse text, not a drawing / solid frame in the band.
    if (darkPct < 0.004 || darkPct > 0.1) continue;

    let textDark = 0;
    const ty0 = Math.max(gapY1, Math.floor(band * 0.4));
    const ty1 = Math.floor(band * 0.95);
    for (let y = ty0; y < ty1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        if (data[y * info.width + x] < 200) textDark += 1;
      }
    }
    const textPct = textDark / Math.max(1, (ty1 - ty0) * span);
    if (textPct < 0.01 || textPct > 0.22) continue;

    return Math.min(height - 40, band);
  }
  return null;
}

/** Remove Something for Little Ones print stamp from the bottom of a page PNG. */
export async function stripSiteFooter(image: Buffer): Promise<Buffer> {
  const crop = await detectSiteFooterHeight(image);
  if (!crop) return image;
  const meta = await sharp(image).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const keep = height - crop;
  if (keep < 80) return image;
  return sharp(image).extract({ left: 0, top: 0, width, height: keep }).png().toBuffer();
}

export async function stampSite(png: Buffer) {
  const { host } = readSite();
  const meta = await sharp(png).metadata();
  const width = meta.width ?? 1600;
  const band = footerHeight(width);
  const hostSize = Math.round(band * 0.34);
  const captionSize = Math.round(band * 0.15);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${band}" viewBox="0 0 ${width} ${band}">
  <rect width="${width}" height="${band}" fill="#ffffff"/>
  <line x1="${Math.round(width * 0.18)}" y1="${Math.round(band * 0.16)}" x2="${Math.round(width * 0.82)}" y2="${Math.round(band * 0.16)}" stroke="#241C18" stroke-width="${Math.max(2, Math.round(width * 0.0012))}"/>
  <text x="${width / 2}" y="${Math.round(band * 0.58)}" text-anchor="middle" font-family="Georgia" font-size="${hostSize}" fill="#241C18">${xml(host)}</text>
  <text x="${width / 2}" y="${Math.round(band * 0.84)}" text-anchor="middle" font-family="Arial" font-size="${captionSize}" letter-spacing="${Math.round(captionSize * 0.18)}" fill="#6D625B">FREE PRINTABLE COLORING PAGE</text>
</svg>`;
  const footer = new Resvg(svg, {
    font: {
      fontFiles: fontCandidates.filter((file) => fs.existsSync(file)),
      loadSystemFonts: true,
      defaultFontFamily: 'Georgia',
    },
    fitTo: { mode: 'width', value: width },
  }).render().asPng();
  return sharp(png)
    .extend({ bottom: band, background: '#ffffff' })
    .composite([{ input: Buffer.from(footer), gravity: 'south' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}
