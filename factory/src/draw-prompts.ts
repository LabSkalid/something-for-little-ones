import fs from 'node:fs';
import path from 'node:path';
import { factoryRoot } from './paths.ts';

/** Ages the factory can draw. 4–8 is the book budget. */
export const DRAW_AGES = ['2-3', '3-4', '4-5', '5-6', '6-8', '4-8'] as const;

export const drawPromptFile = path.join(factoryRoot, 'scripts', 'draw-prompts.json');

const plain = 'Thick black outlines, pure white background, no shading, no text, no trademarked characters.';

export type DrawPrompts = {
  ageCap: Record<string, string>;
  layout: Record<string, string>;
  style: Record<string, string>;
};

/** Code defaults. The JSON file overrides these after you save in the factory. */
export const defaultDrawPrompts: DrawPrompts = {
  ageCap: {
    '2-3': '',
    '3-4': '',
    '4-5':
      'Draw only this age: the named figures and one or two big props on an empty white background. Leave out any room, floor, trees, and furniture.',
    '5-6':
      'Draw this age with crayon-sized regions on the named subject and several medium props. Leave out any room, floorboards, brick courses, and crowd. Do not add an animal the subject did not name.',
    '6-8': '',
    '4-8': '',
  },
  layout: {
    '2-3':
      'One object only, made of very few huge closed shapes. Extra-thick outlines. Almost no small parts and no background scene. Leave lots of white space. A toddler should be able to scribble across each shape.',
    '3-4':
      'One subject, large and centered, with white space around it. Thick closed outlines and a handful of big regions. A young child should be able to color every region with a crayon.',
    '4-5':
      'AGE BUDGET, this overrides the subject. A few large figures on an empty white background, or one figure plus two or three big props. No room, no floor, no trees, no furniture, no brick pattern. Simpler than a small scene for ages 5 to 6. Thick closed outlines.',
    '5-6':
      'AGE BUDGET for ages 5 to 6. One or two large characters, one action, and several medium props or a simple backdrop of a few big shapes. Crayon-sized regions: busier than one figure on empty white, much simpler than a furnished room. No room, no floorboards, no brick courses, no crowd, and no tiny engraving. Thick closed outlines. Draw the named subject. Do not add an animal, spots, or an outdoor setting the subject did not name.',
    '6-8':
      'A fuller scene or a repeating pattern with many separate regions to color. The picture can use more of the page. Outlines stay bold and closed, clearly thick enough to print and color with a crayon, never hairline engraving, never crosshatching, never gray fill. Make this busier than a small scene: a room or a full setting is allowed, with more objects and smaller regions that are still easy to see on paper. Do not switch to hairline pen work.',
    '4-8':
      'A storybook subject in its costume, large enough to color, with the hat, feather, cape, boots, ears, muzzle, and tail kept as separate closed shapes when the subject has them. A few nearby props are fine. Thick closed outlines. Not a toddler scribble of one round head, and not a hairline engraving.',
  },
  style: {
    '2-3':
      'Toddler coloring page, one huge simple object, extra-thick black outlines, almost no small parts, pure white background, no shading, no text, no trademarked characters.',
    '3-4': `One large subject, centered, with a handful of big regions. ${plain}`,
    '4-5': `A few large figures or one figure with two or three big props, on an empty white background. No room and no scenery. Simpler than a page for ages 5 to 6. ${plain}`,
    '5-6': `One or two large characters, one action, and one simple backdrop of a few big shapes. No furnished room, no floorboards, no brick courses, no crowd. ${plain}`,
    '6-8': `A fuller scene with many colorable regions. Bolder and busier than a small scene for ages 5 to 6. ${plain}`,
    '4-8': `Storybook coloring page, bold closed outlines, pure white background. ${plain}`,
  },
};

function pick(input: unknown, fallback: Record<string, string>) {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const age of DRAW_AGES) {
    const value = source[age];
    out[age] = (typeof value === 'string' ? value : fallback[age] ?? '').slice(0, 2500);
  }
  return out;
}

export function normalizeDrawPrompts(input: unknown): DrawPrompts {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    ageCap: pick(source.ageCap, defaultDrawPrompts.ageCap),
    layout: pick(source.layout, defaultDrawPrompts.layout),
    style: pick(source.style, defaultDrawPrompts.style),
  };
}

let cached: DrawPrompts | null = null;
let cachedMtime = -1;

export function currentDrawPrompts(): DrawPrompts {
  try {
    const stat = fs.statSync(drawPromptFile);
    if (cached && stat.mtimeMs === cachedMtime) return cached;
    cached = normalizeDrawPrompts(JSON.parse(fs.readFileSync(drawPromptFile, 'utf8')));
    cachedMtime = stat.mtimeMs;
    return cached;
  } catch {
    cached = null;
    cachedMtime = -1;
    return defaultDrawPrompts;
  }
}

export function ageCap(age: string) {
  return (currentDrawPrompts().ageCap[age] ?? '').trim();
}

export function ageLayout(age: string) {
  return (currentDrawPrompts().layout[age] ?? '').trim();
}

export function ageStyle(age: string) {
  return (currentDrawPrompts().style[age] ?? defaultDrawPrompts.style[age] ?? defaultDrawPrompts.style['3-4']).trim();
}

export function saveDrawPrompts(input: unknown) {
  const prompts = normalizeDrawPrompts(input);
  fs.mkdirSync(path.dirname(drawPromptFile), { recursive: true });
  fs.writeFileSync(drawPromptFile, `${JSON.stringify(prompts, null, 2)}\n`, 'utf8');
  cached = prompts;
  cachedMtime = fs.statSync(drawPromptFile).mtimeMs;
  return prompts;
}

export function resetDrawPrompts() {
  return saveDrawPrompts(defaultDrawPrompts);
}
