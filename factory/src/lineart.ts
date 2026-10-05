import sharp from 'sharp';

export async function toLineArt(input: Buffer) {
  const base = sharp(input).flatten({ background: '#ffffff' }).grayscale().normalize();
  const traced = await base.clone().threshold(168).png().toBuffer();
  const stats = await sharp(traced).stats();
  const mean = stats.channels[0]?.mean ?? 255;
  if (mean < 12 || mean > 248) {
    return base.png().toBuffer();
  }
  return traced;
}

export async function fitPortrait(input: Buffer, width = 1600, height = 2000) {
  return sharp(input)
    .trim({ background: '#ffffff', threshold: 12 })
    .extend({ top: 40, bottom: 40, left: 40, right: 40, background: '#ffffff' })
    .resize(width, height, { fit: 'contain', background: '#ffffff' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function webPreview(printPng: Buffer) {
  return sharp(printPng).resize({ width: 1000 }).png({ compressionLevel: 9, palette: true }).toBuffer();
}
