/** Page titles stay searchable. The image model gets a scene, not a film name. */

const MODEL_NOTE =
  /,?\s*\b(?:classic|traditional|original|public[- ]domain)\s+fairy\s+ta(?:il|le)s?\b|\b(?:not|no|without)\s+disney\b|\bpublic[- ]domain\b/gi

export function stripModelNotes(text: string) {
  return text
    .replace(MODEL_NOTE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/^[,.\s]+|[,.\s]+$/g, '')
    .trim();
}

const NAME_SWAPS: [RegExp, string][] = [
  [/\bcinderella\b/gi, 'a young woman in a simple clean dress'],
  [/\bsnow white\b/gi, 'a young woman in a simple storybook dress'],
  [/\b(the )?little mermaid\b/gi, 'a mermaid'],
  [/\bariel\b/gi, 'a mermaid'],
  [/\bsleeping beauty\b/gi, 'a sleeping young woman'],
  [/\baurora\b/gi, 'a sleeping young woman'],
  [/\bpinocchio\b/gi, 'a wooden puppet with a long nose'],
  [/\brapunzel\b/gi, 'a young woman with very long hair'],
  [/\bpuss in boots\b/gi, 'an upright cat in boots, a cape, and a feathered hat'],
  [/\bgoldilocks\b/gi, 'a girl with long hair'],
  [/\bthree little pigs\b/gi, 'three friendly pigs'],
  [/\blittle red riding hood\b/gi, 'a girl in a hooded cape with a basket'],
  [/\bgingerbread man\b/gi, 'a smiling gingerbread cookie'],
  [/\bugly duckling\b/gi, 'a young swan'],
  [/\bhansel and gretel\b/gi, 'a boy and a girl'],
  [/\bhansel\b/gi, 'a boy'],
  [/\bgretel\b/gi, 'a girl'],
  [/\bjack and the beanstalk\b/gi, 'a boy beside a giant beanstalk'],
];

const SCENES: { match: RegExp; scene: string }[] = [
  {
    match: /goldilocks|three bears/i,
    scene:
      'A smiling girl with long hair sits at a wooden table with three bowls and three chairs of different sizes. Three friendly bears of different sizes stand beside the table.',
  },
  {
    match: /three little pigs/i,
    scene:
      'Three friendly pigs stand in a row. Behind them are three simple houses: one of straw, one of sticks, and one of bricks.',
  },
  {
    match: /red riding hood/i,
    scene:
      'A smiling girl in a hooded cape carries a small basket on a forest path. Simple trees and a small cottage are in the distance.',
  },
  {
    match: /gingerbread/i,
    scene: 'One large smiling gingerbread cookie with three buttons and arms out, as if running.',
  },
  {
    match: /ugly duckling/i,
    scene: 'A young swan with a long neck swims on a pond with a few lily pads and reeds.',
  },
  {
    match: /puss in boots/i,
    scene: 'An upright cat wearing boots, a short cape, and a hat with a feather.',
  },
  {
    match: /cinderella.*sweep|sweep.*cinderella|sweeping/i,
    scene:
      'A smiling young woman in a simple clean dress and apron sweeps a wooden floor with a broom. A window, a plant, and a cupboard are in the room.',
  },
  {
    match: /cinderella|fireplace|hearth/i,
    scene:
      'A smiling young woman in a simple clean dress sits beside a fireplace, with a broom, a bucket, and a few logs nearby.',
  },
  {
    match: /hansel|gretel/i,
    scene: 'A boy and a girl stand in front of a cottage decorated with candy and icing. Simple trees are behind them.',
  },
  {
    match: /beanstalk/i,
    scene: 'A boy looks up at a very tall beanstalk with big leaves. A simple castle sits in the clouds at the top.',
  },
  {
    match: /pinocchio|wooden puppet/i,
    scene: 'A smiling wooden puppet with a long nose, a soft hat, and short trousers.',
  },
  {
    match: /snow white/i,
    scene:
      'A smiling young woman in a simple full dress sits on a log. A deer, a rabbit, and a bird are beside her.',
  },
  {
    match: /rapunzel|tower/i,
    scene:
      'A young woman with very long hair leans from a tall tower window. A young man in a plain coat stands at the foot of the tower.',
  },
  {
    match: /sleeping beauty|sleeping princess/i,
    scene: 'A young woman with long hair sleeps peacefully on a simple bed, with one rose on the pillow.',
  },
  {
    match: /mermaid/i,
    scene: 'A mermaid with long hair and a fish tail sits on a rock. A few fish, one crab, and a distant sailing ship.',
  },
];

function softenNames(text: string) {
  let scene = text;
  for (const [pattern, replacement] of NAME_SWAPS) scene = scene.replace(pattern, replacement);
  return scene.replace(/\s{2,}/g, ' ').trim();
}

function isOnlyTheName(text: string) {
  let rest = stripModelNotes(text);
  for (const [pattern] of NAME_SWAPS) rest = rest.replace(pattern, ' ');
  const words = rest
    .split(/\s+/)
    .filter((word) => /[a-z]/i.test(word) && !/^(and|the|a|an|of|with|in|on|at|their)$/i.test(word));
  return words.length < 3;
}

/** What the image model should see. Famous tale names stay off this string. */
export function imageSubject(title: string, prompt: string) {
  const note =
    'Generic storybook coloring page. Do not copy a character, costume, or pose from a film, series, doll, or theme park.';
  const blob = `${title}\n${prompt}`;
  const stock = SCENES.find((item) => item.match.test(blob));
  const cleaned = stripModelNotes(prompt);
  const scene = !cleaned || isOnlyTheName(cleaned) ? stock?.scene ?? softenNames(stripModelNotes(title)) : softenNames(cleaned);
  return `${scene} ${note}`;
}
