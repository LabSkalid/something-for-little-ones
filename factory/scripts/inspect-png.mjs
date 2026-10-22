import sharp from 'sharp';
const f = process.argv[2];
const img = sharp(f);
const m = await img.metadata();
const s = await img.stats();
console.log(JSON.stringify({ m, means: s.channels.map((c) => c.mean) }, null, 2));
