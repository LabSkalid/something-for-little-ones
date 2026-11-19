/** Page titles stay searchable. The image model gets a plain scene, not a film name. */

const MODEL_NOTE =
  /,?\s*\b(?:classic|traditional|original|public[- ]domain)\s+fairy\s+ta(?:il|le)s?(?:\s+episode)?\b|\b(?:not|no|without)\s+disney\b|\bpublic[- ]domain\b/gi;

const FILLER = new Set([
  'episode',
  'story',
  'tale',
  'scene',
  'classic',
  'coloring',
  'page',
  'drawing',
  'simple',
  'fairy',
  'traditional',
  'original',
]);

/** Plain public-domain moments. No film costume, no characters invented for a film. */
const PLAIN_SCENES: { match: RegExp; scene: string }[] = [
  {
    match: /seven dwarfs/i,
    scene:
      'Inside a cottage, a young woman with very long loose hair and no hair bow wears a floor-length gown with a belt and long fitted sleeves. She sets bowls on a low table for seven dwarfs. Each dwarf is only half her height, with a large head, a full beard, and a simple pointed cap. They are small folk, not adult men, and they look similar to each other. No puffed sleeves, no high white collar, no musical instruments.',
  },
  {
    match: /snow white/i,
    scene:
      'A young woman with very long loose hair and no hair bow wears a floor-length gown with a belt and long fitted sleeves. She holds one apple. Two dwarfs stand beside her, each only half her height, with large heads, full beards, and simple pointed caps. They are small folk, not adult men. No apron, no braid, no puffed sleeves, no cottage, no deer.',
  },
  {
    match: /pinocchio|wooden puppet/i,
    scene:
      'A wooden puppet with visible joints and a long wooden nose, wearing a plain shirt and long trousers, stands beside an old bearded woodcarver at a workbench with a few blocks of wood. No feathered hat, no bow tie, no shorts, no cat, no cricket.',
  },
  {
    match: /aladdin|magic lamp/i,
    scene:
      'A young man in a plain robe kneels holding an old brass lamp. A genie rises from the spout: his lower body is only a thick column of smoke, with no legs and no robe. His upper body is much larger than the man, with a broad beard, pointed ears, and bare shoulders. He is a spirit, not a second man in a turban. No topknot, no single earring, no comic grin.',
  },
  {
    match: /beauty and the beast/i,
    scene:
      'A young woman in a simple high-necked long dress sits at a table opposite a large furry beast whose head mixes a wolf and a bear: a broad bear skull, small round bear ears, a short wolf muzzle, thick cheek fur, and a few sharp teeth. No pig snout, no tusks, no floppy pig ears, no lion mane, no curved horns, no tailcoat. He wears a loose plain robe. A bowl of fruit and a candle sit on the table, with no faces. No ballgown.',
  },
  {
    match: /alice|wonderland/i,
    scene:
      'A girl in a simple long dress sits at a tea table with a rabbit wearing a coat and a man in a tall plain hat. Ordinary storybook faces. A teapot and a few cups.',
  },
  {
    match: /nutcracker/i,
    scene:
      'A wooden toy soldier in a plain tall hat and a simple coat faces a mouse wearing a small crown. A few smaller toy soldiers stand behind him.',
  },
  {
    match: /cinderella/i,
    scene:
      'A young woman in a plain long dress and apron sweeps a wooden floor with a broom. A window and a cupboard are in the room. No glass slippers, no ballgown.',
  },
  {
    match: /rapunzel/i,
    scene:
      'A young woman with very long loose hair leans from a tall plain tower window. A young man in a plain coat stands at the foot of the tower.',
  },
  {
    match: /sleeping beauty|sleeping princess/i,
    scene: 'A young woman with long loose hair sleeps on a simple bed, with one rose on the pillow. No crown, no castle ballroom.',
  },
  {
    match: /mermaid/i,
    scene: 'A mermaid with long loose hair and a plain fish tail sits on a rock. Two fish and one crab are in the water. No seashell top, no red hair as a costume.',
  },
  {
    match: /goldilocks|three bears/i,
    scene:
      'A girl with long hair sits at a wooden table with three bowls and three chairs of different sizes. Three friendly bears of different sizes stand beside the table.',
  },
  {
    match: /three little pigs/i,
    scene: 'Three friendly pigs stand in a row. One holds a bundle of sticks. One holds a few bricks.',
  },
  {
    match: /red riding hood/i,
    scene: 'A girl in a plain hooded cape carries a small basket. A tree is behind her.',
  },
  {
    match: /gingerbread/i,
    scene: 'One large smiling gingerbread cookie with three buttons and arms out.',
  },
  {
    match: /ugly duckling/i,
    scene: 'A young swan with a long neck swims on a pond with a few reeds.',
  },
  {
    match: /puss in boots/i,
    scene: 'An upright cat wearing plain boots, a short cape, and a simple hat.',
  },
  {
    match: /hansel|gretel/i,
    scene: 'A boy and a girl stand in front of a small cottage with a few candies on the roof. Simple trees are behind them.',
  },
  {
    match: /beanstalk/i,
    scene: 'A boy looks up at a very tall beanstalk with big leaves.',
  },
];

const PLAIN =
  'Plain original storybook coloring page. Ordinary clothes and ordinary faces. Do not copy a character, costume, hair bow, pose, or prop from a film, series, doll, or theme park.';

/**
 * Shorter than PLAIN_SCENES. A bare tale name otherwise expands into a room,
 * and the image model draws every listed object, which lands on ages 6–8.
 * 4–5 is a group on white. 5–6 is one or two figures plus one simple backdrop.
 */
const YOUNG_SCENES: Record<string, { match: RegExp; scene: string }[]> = {
  '4-5': [
    {
      match: /goldilocks|three bears/i,
      scene: 'A girl with long hair stands in front of three friendly bears of different sizes. Empty background. No table, no bowls, no chairs, no room.',
    },
    {
      match: /three little pigs/i,
      scene: 'Three friendly pigs stand together. One holds a bundle of sticks. One holds a few bricks. Empty background. No houses and no wolf.',
    },
    {
      match: /red riding hood/i,
      scene: 'A girl in a plain hooded cape holds a small basket. Empty background. No wolf, no tree, no cottage.',
    },
    {
      match: /gingerbread/i,
      scene: 'One large smiling gingerbread cookie with three buttons and arms out. Empty background.',
    },
    {
      match: /cinderella/i,
      scene: 'A young woman in a plain long dress holds a broom. Empty background. No room, no floor, no cupboard, no fireplace.',
    },
    {
      match: /puss in boots/i,
      scene: 'An upright cat wearing plain boots, a short cape, and a simple hat. Empty background. No castle and no carriage.',
    },
  ],
  '5-6': [
    {
      match: /rapunzel/i,
      scene: 'One young woman with very long loose hair leans from one plain window. The tower is a single tall rectangle with no bricks. No second person and no forest.',
    },
    {
      match: /beanstalk/i,
      scene: 'One boy looks up at one tall beanstalk with a few big leaves. No castle, no giant, and no house.',
    },
    {
      match: /pinocchio|wooden puppet/i,
      scene: 'One wooden puppet with a long nose and a few visible joints stands beside one plain workbench block. No second person, no tools, and no workshop full of objects.',
    },
    {
      match: /red riding hood/i,
      scene: 'One girl in a plain hooded cape holds a basket. One tree with a few big leaves stands behind her. No wolf, no cottage, and no path of stones.',
    },
    {
      match: /cinderella/i,
      scene: 'One young woman in a plain long dress holds a broom beside one large pumpkin. No room, no floor, no cupboard, and no second person.',
    },
    {
      match: /puss in boots/i,
      scene: 'One upright cat wears plain boots, a short cape, and a hat with one feather. One simple door shape is behind him. No castle wall, no carriage, and no crowd.',
    },
    {
      match: /hansel|gretel/i,
      scene: 'One boy and one girl stand side by side. Behind them is one plain house shape with three big candy circles on the roof. No forest, no bricks, and no witch.',
    },
    {
      match: /snow white/i,
      scene: 'One young woman with long loose hair holds one apple. One small bearded figure in a pointed cap stands beside her, and one tree with a few big leaves is behind them. No cottage and no extra dwarfs.',
    },
    {
      match: /mermaid/i,
      scene: 'One mermaid with long loose hair and a plain fish tail sits on one rock. Two fish are in the water. No crab, no seaweed field, and no castle.',
    },
    {
      match: /goldilocks|three bears/i,
      scene: 'One girl with long hair stands beside one friendly bear. Two bowls of different sizes sit in front of them. No table, no chairs, no room, and no other bears.',
    },
    {
      match: /three little pigs/i,
      scene: 'One friendly pig holds three bricks. One simple house shape with a door is behind the pig. No other pigs, no straw, and no wolf.',
    },
  ],
};

const AGE_CAP: Record<string, string> = {
  '4-5':
    'Draw only this age: the named figures and one or two big props on an empty white background. Leave out any room, floor, trees, and furniture.',
  '5-6':
    'Draw this age like a spotted dinosaur outdoors: a pattern of crayon-sized regions on the subject and several medium props. Leave out any room, floorboards, brick courses, and crowd.',
};

export function stripModelNotes(text: string) {
  return text
    .replace(MODEL_NOTE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/^[,.\s]+|[,.\s]+$/g, '')
    .trim();
}

export function taleName(title: string) {
  return stripModelNotes(title).replace(/\s+coloring page$/i, '').trim();
}

/** The user's scene, when they wrote one. A bare tale name or a note like "classic fairy tale episode" is not a scene. */
export function sceneDescription(title: string, prompt: string) {
  const tale = taleName(title).toLowerCase();
  let text = stripModelNotes(prompt)
    .replace(/^a simple\s+/i, '')
    .replace(/\s+coloring page drawing$/i, '')
    .replace(/\s+fairy tale$/i, '')
    .replace(/\s+coloring page$/i, '')
    .trim();
  if (!text || text.toLowerCase() === tale) return '';
  const words = text.split(/\s+/).filter((word) => /[a-z]/i.test(word));
  if (!words.length || words.every((word) => FILLER.has(word.toLowerCase().replace(/[^a-z]/gi, '')))) return '';
  return text;
}

export function plainScene(title: string, prompt: string, age = '') {
  const blob = `${title}\n${prompt}`;
  const young = YOUNG_SCENES[age];
  const shorter = young?.find((item) => item.match.test(blob))?.scene;
  if (shorter) return shorter;
  return PLAIN_SCENES.find((item) => item.match.test(blob))?.scene ?? '';
}

/** What the image model should draw. A missing scene becomes a plain storybook moment, never the tale's film title. */
export function imageSubject(title: string, prompt: string, retry = false, age = '') {
  const scene = sceneDescription(title, prompt) || plainScene(title, prompt, age);
  const moment = scene
    ? scene
    : 'One plain original storybook moment with ordinary clothes. You choose a simple cheerful scene.';
  const cap = AGE_CAP[age] ?? '';
  if (retry) {
    return `${moment} ${cap} Cheerful coloring page. No famous names, no film costumes, no distress.`.replace(/\s{2,}/g, ' ').trim();
  }
  return `${moment} ${cap} ${PLAIN}`.replace(/\s{2,}/g, ' ').trim();
}
