/** Obvious English typos in page titles. Slug is rebuilt after the fix. */
const WORD_FIX: Record<string, string> = {
  buny: 'bunny',
  bunnny: 'bunny',
  buuny: 'bunny',
  rabbot: 'rabbit',
  dinosuar: 'dinosaur',
  dinosor: 'dinosaur',
  leprachaun: 'leprechaun',
  lepricon: 'leprechaun',
  valetnine: 'valentine',
  patrics: 'patricks',
};

function fixWord(word: string) {
  const lower = word.toLowerCase();
  const rep = WORD_FIX[lower];
  if (!rep) return word;
  if (word === word.toUpperCase()) return rep.toUpperCase();
  if (word[0] === word[0]?.toUpperCase()) return rep.charAt(0).toUpperCase() + rep.slice(1);
  return rep;
}

export function fixPageNameSpelling(name: string) {
  const parts = name.split(/(\s+)/);
  let changed = false;
  const out = parts.map((part) => {
    if (!part.trim()) return part;
    const next = fixWord(part);
    if (next !== part) changed = true;
    return next;
  });
  return { name: out.join(''), changed };
}

/** Pad short prompts without turning every holiday line into a fairy tale. */
export function padDrawPrompt(prompt: string, name: string) {
  const text = prompt.trim();
  if (text.length >= 8) return text;
  const blob = `${name} ${text}`.toLowerCase();
  if (/\bfairy\b|\btale\b|dwarf|snow white|cinderella|pinocchio|rapunzel\b/.test(blob)) {
    return `${text || name} fairy tale`;
  }
  const base = text || name;
  return base.length >= 8 ? base : `${base} coloring page`;
}