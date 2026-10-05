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
