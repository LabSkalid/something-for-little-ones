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
      'A young woman in a plain long-sleeved dress and a simple apron, hair in one braid and no hair bow, shares a round loaf at a wooden table with four bearded miners. The miners look alike and wear the same plain tunic and the same plain cap. No puffed sleeves, no high collar, no apples, no musical instruments.',
  },
  {
    match: /snow white/i,
    scene:
      'A young woman in a plain long-sleeved dress and a simple apron, hair in one braid and no hair bow, stands by one tree. A rabbit sits beside her and one bird sits on a branch. No cottage, no apples, no basket, no puffed sleeves.',
  },
  {
    match: /pinocchio|wooden puppet/i,
    scene:
      'A wooden puppet with visible joints and a long wooden nose, wearing a plain shirt and long trousers, stands beside an old bearded woodcarver at a workbench with a few blocks of wood. No feathered hat, no bow tie, no shorts, no cat, no cricket.',
  },
  {
    match: /aladdin|magic lamp/i,
    scene:
      'A young man in a plain long robe and a simple wrapped cloth on his head kneels on a rug, holding an old brass oil lamp. A tall quiet figure made of smoke, in a plain robe, rises from the lamp. No bare chest, no earring, no topknot, no comic grin, no palace.',
  },
  {
    match: /beauty and the beast/i,
    scene:
      'A young woman in a simple high-necked long dress sits at a table opposite a large gentle horned animal wearing a plain coat. A bowl of fruit, a plain teapot, and a plain candle sit on the table, all without faces. No ballgown, no off-the-shoulder dress.',
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

export function plainScene(title: string, prompt: string) {
  const blob = `${title}\n${prompt}`;
  return PLAIN_SCENES.find((item) => item.match.test(blob))?.scene ?? '';
}

/** What the image model should draw. A missing scene becomes a plain storybook moment, never the tale's film title. */
export function imageSubject(title: string, prompt: string, retry = false) {
  const scene = sceneDescription(title, prompt) || plainScene(title, prompt);
  const moment = scene
    ? scene
    : 'One plain original storybook moment with ordinary clothes. You choose a simple cheerful scene.';
  if (retry) {
    return `${moment} Cheerful coloring page. No famous names, no film costumes, no distress.`;
  }
  return `${moment} ${PLAIN}`;
}
