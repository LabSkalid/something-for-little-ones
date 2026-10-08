import fs from 'node:fs/promises';
import path from 'node:path';

const dir = 'D:/KIDS/site/src/content/sheets/rocket-coloring-pages';

/** @type {Record<string, { age: string; order: number; difficulty: string; description?: string; parentNote?: string }>} */
const plan = {
  'huge-rocket': {
    age: '2-3',
    order: 1,
    difficulty: 'toddler',
  },
  'chunky-rocket': {
    age: '2-3',
    order: 2,
    difficulty: 'toddler',
  },
  'capsule-rocket': {
    age: '2-3',
    order: 3,
    difficulty: 'toddler',
  },
  'two-round-windows': {
    age: '3-4',
    order: 10,
    difficulty: 'easy',
    description:
      'Two big round windows, two fins, and a flame. Still one rocket on a white page. For about ages 3 to 4.',
    parentNote: 'The body is one big shape. The two windows can be the same color, or left white.',
  },
  'round-window': {
    age: '3-4',
    order: 11,
    difficulty: 'easy',
    description:
      'One round window and a flame, with a few motion lines. For about ages 3 to 4.',
    parentNote: 'Color the body first. The little lines beside the rocket can stay white.',
  },
  'cloud-rocket': {
    age: '3-4',
    order: 12,
    difficulty: 'easy',
    description: 'A thick rocket, one window, and one cloud. For about ages 3 to 4.',
  },
  'tilted-rocket': {
    age: '3-4',
    order: 13,
    difficulty: 'easy',
    description: 'A tilted rocket with two windows, a flame, one cloud, and one star. For about ages 3 to 4.',
  },
  'striped-rocket': {
    age: '3-4',
    order: 14,
    difficulty: 'easy',
    description: 'A rocket with stripes, one round window, and a cloud. For about ages 3 to 4.',
  },
  'spark-rocket': {
    age: '4-5',
    order: 20,
    difficulty: 'easy',
    description: 'A rocket with a window, fins, a flame, and a few sparks. For about ages 4 to 5.',
  },
  'antenna-rocket': {
    age: '4-5',
    order: 21,
    difficulty: 'easy',
  },
  'two-windows': {
    age: '4-5',
    order: 22,
    difficulty: 'easy',
  },
  'two-stars': {
    age: '4-5',
    order: 23,
    difficulty: 'easy',
  },
  'rivet-rocket': {
    age: '4-5',
    order: 24,
    difficulty: 'easy',
  },
  'starry-rocket': {
    age: '4-5',
    order: 25,
    difficulty: 'easy',
  },
  'little-clouds': {
    age: '4-5',
    order: 26,
    difficulty: 'easy',
  },
  'little-porthole': {
    age: '5-6',
    order: 30,
    difficulty: 'medium',
    description:
      'One porthole, an antenna, and a flame, with more lines on the fins. For about ages 5 to 6.',
  },
  'tall-fins': {
    age: '5-6',
    order: 31,
    difficulty: 'medium',
    description: 'A tall rocket with long fins, windows, and a detailed flame. For about ages 5 to 6.',
  },
  'star-windows': {
    age: '5-6',
    order: 32,
    difficulty: 'medium',
  },
  'sketch-launch': {
    age: '5-6',
    order: 33,
    difficulty: 'medium',
  },
  'ringed-planet': {
    age: '5-6',
    order: 34,
    difficulty: 'medium',
  },
  'speedy-planet': {
    age: '5-6',
    order: 35,
    difficulty: 'medium',
  },
  'tilted-stars': {
    age: '5-6',
    order: 36,
    difficulty: 'medium',
  },
  'rivet-stars': {
    age: '5-6',
    order: 37,
    difficulty: 'medium',
  },
  'cloudy-sky': {
    age: '6-8',
    order: 40,
    difficulty: 'detailed',
  },
  'flying-rocket': {
    age: '6-8',
    order: 41,
    difficulty: 'detailed',
  },
  'ringed-sky': {
    age: '6-8',
    order: 42,
    difficulty: 'detailed',
  },
  'meteor-launch': {
    age: '6-8',
    order: 43,
    difficulty: 'detailed',
  },
  'big-planet': {
    age: '6-8',
    order: 44,
    difficulty: 'detailed',
  },
  'moon-launch': {
    age: '6-8',
    order: 45,
    difficulty: 'detailed',
  },
  'shuttle-launch': {
    age: '6-8',
    order: 46,
    difficulty: 'detailed',
  },
};

const counts = {};
for (const [slug, meta] of Object.entries(plan)) {
  const file = path.join(dir, `${slug}.md`);
  let raw = await fs.readFile(file, 'utf8');
  raw = raw.replace(/^age:\s*.+$/m, `age: "${meta.age}"`);
  raw = raw.replace(/^order:\s*\d+/m, `order: ${meta.order}`);
  raw = raw.replace(/^difficulty:\s*.+$/m, `difficulty: ${meta.difficulty}`);
  if (meta.description) {
    raw = raw.replace(/^description:\s*.+$/m, `description: ${JSON.stringify(meta.description)}`);
  }
  if (meta.parentNote) {
    raw = raw.replace(/^parentNote:\s*.+$/m, `parentNote: ${JSON.stringify(meta.parentNote)}`);
  }
  await fs.writeFile(file, raw);
  counts[meta.age] = (counts[meta.age] || 0) + 1;
  console.log(`${slug} -> ${meta.age} (#${meta.order})`);
}

console.log('counts', counts);
