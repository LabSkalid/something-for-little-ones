import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const fontCandidates = [
  'C:/Windows/Fonts/georgia.ttf',
  'C:/Windows/Fonts/georgiab.ttf',
  'C:/Windows/Fonts/arial.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
];

function xml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function wrap(value: string, max: number) {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

export function renderPin(options: {
  title: string;
  subtitle: string;
  accent: string;
  brand: string;
  images: Buffer[];
}) {
  const images = options.images.slice(0, 4);
  const titleLines = wrap(options.title, 18);
  const cards = images.map((image, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 64 + col * (422 + 28);
    const y = 470 + row * (450 + 24);
    const href = `data:image/png;base64,${image.toString('base64')}`;
    return `
      <rect x="${x}" y="${y}" width="422" height="450" rx="28" fill="#ffffff"/>
      <image href="${href}" x="${x + 36}" y="${y + 28}" width="350" height="394" preserveAspectRatio="xMidYMid meet"/>
    `;
  });
  const title = titleLines
    .map((line, index) => `<text x="64" y="${150 + index * 78}" font-family="Georgia" font-size="68" font-weight="700" fill="#241C18">${xml(line)}</text>`)
    .join('');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500" viewBox="0 0 1000 1500">
  <rect width="1000" height="1500" fill="#F6F1EA"/>
  <rect width="1000" height="18" fill="${options.accent}"/>
  <text x="64" y="78" font-family="Arial" font-size="18" font-weight="700" fill="${options.accent}" letter-spacing="1.6">${xml(options.brand.toUpperCase())}</text>
  ${title}
  <text x="64" y="${168 + titleLines.length * 78}" font-family="Arial" font-size="32" fill="#6D625B">${xml(options.subtitle)}</text>
  ${cards.join('\n')}
  <text x="64" y="1456" font-family="Arial" font-size="24" font-weight="700" fill="#241C18" letter-spacing="2">FREE PRINTABLE</text>
</svg>`;
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: fontCandidates.filter((file) => fs.existsSync(file)),
      loadSystemFonts: true,
      defaultFontFamily: 'Arial',
    },
    fitTo: { mode: 'width', value: 1000 },
  });
  return Buffer.from(resvg.render().asPng());
}

export function pinFileName(themeId: string, pinId: string) {
  return `${themeId}-${pinId}.png`;
}

export function safePinPath(root: string, themeId: string, pinId: string) {
  return path.join(root, pinFileName(themeId, pinId));
}
