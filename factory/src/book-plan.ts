import { ageBudget, chat, type LineDifficulty } from './openrouter.ts';
import { type TaleCharacter } from './tale-cast.ts';

export type BookPlanIdea = {
  title: string;
  prompt: string;
  difficulty: LineDifficulty;
  index: number;
  cast?: string[];
};

const FILM_ONLY = /\b(anastasia|drizella|bibbidi|bobbidi|gus-gus|jaq|maleficent|flounder|ursula|lumiere|cogsworth|dopey|grumpy|bashful|sneezy)\b/i;

type RawIdea = { title?: string; prompt?: string; difficulty?: string; beat?: number | string; cast?: unknown };
type Slice = { fromPage: number; toPage: number; fromBeat: number; toBeat: number };

export function isSafetyRejection(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /safety system|rejected by the safety/i.test(message);
}

/** Image models reject trademarked names and a child shown in hardship. */
export function softenTaleSubject(subject: string, level: 'names' | 'tale' | 'retry' = 'names') {
  let text = subject;
  const swaps: [RegExp, string][] = [
    [/\bthe prince\b/gi, 'the young man in the long embroidered coat'],
    [/\bprince\b/gi, 'the young man in the long embroidered coat'],
    [/\b(cinderella|cendrillon|aschenputtel|sinderella)\b/gi, 'the heroine'],
    [/золушк[а-я]*/gi, 'the heroine'],
    [/\b(anastasia|drizella)\b/gi, 'a stepsister'],
    [/\b(jaq|gus-gus|bibbidi-bobbidi-boo|bibbidi|bobbidi)\b/gi, ''],
    [/\bragged clothes\b/gi, 'a simple clean dress'],
    [/,?\s*resting among the ashes/gi, ''],
    [/\bamong the ashes\b/gi, 'beside the fireplace'],
    [/\brags and ashes\b/gi, 'a simple clean dress'],
    [/\bin ashes\b/gi, 'by the hearth'],
    [/\band ashes\b/gi, ''],
    [/\brags\b/gi, 'a simple dress'],
    [/\bragged\b/gi, 'plain'],
    [/\btattered\b/gi, 'plain'],
    [/\bfilthy\b/gi, 'clean'],
    [/\bdirty\b/gi, 'clean'],
    [/\bashes\b/gi, 'the hearth'],
    [/\bcinders\b/gi, 'the hearth'],
    [/\bsoot\b/gi, ''],
    [/\bcrying\b/gi, 'standing calmly'],
    [/\bweeping\b/gi, 'standing calmly'],
    [/\btears\b/gi, ''],
    [/\bcruel\b/gi, ''],
    [/\babused?\b/gi, ''],
    [/\bslave\b/gi, ''],
    [/\bbeaten\b/gi, ''],
    [/\bbeating\b/gi, ''],
  ];
  if (level !== 'names') {
    swaps.push(
      [/\blittle girl\b/gi, 'young woman'],
      [/\byoung girl\b/gi, 'young woman'],
      [/\bpoor girl\b/gi, 'young woman'],
      [/\bgirl\b/gi, 'young woman'],
      [/\bchild\b/gi, 'young woman'],
      [/\bpoor\b/gi, 'modest'],
      [/\bpoverty\b/gi, ''],
      [/\bhumble\b/gi, 'quiet'],
      [/\bsad\b/gi, 'calm'],
      [/\bmiserable\b/gi, 'calm'],
      [/\bhungry\b/gi, ''],
      [/\bstarving\b/gi, ''],
      [/\bservant\b/gi, ''],
      [/\borphan\b/gi, ''],
      [/\bneglected\b/gi, ''],
    );
  }
  for (const [pattern, replacement] of swaps) text = text.replace(pattern, replacement);
  text = text.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  if (level === 'retry') {
    text += ' Cheerful coloring-page scene. Every person is a smiling grown storybook character in clean clothes. No distress, no dirt, no harm.';
  }
  return text;
}

export function taleSlices(count: number, beatCount: number): Slice[] {
  const pagesPerSlice = 25;
  const slices: Slice[] = [];
  for (let start = 0; start < count; start += pagesPerSlice) {
    const fromPage = start + 1;
    const toPage = Math.min(count, start + pagesPerSlice);
    const fromBeat = Math.min(beatCount, Math.floor((start * beatCount) / count) + 1);
    let toBeat = Math.floor((toPage * beatCount) / count);
    if (toPage === count) toBeat = beatCount;
    if (toBeat < fromBeat) toBeat = fromBeat;
    if (toBeat > beatCount) toBeat = beatCount;
    slices.push({ fromPage, toPage, fromBeat, toBeat });
  }
  for (let i = 1; i < slices.length; i++) {
    const prev = slices[i - 1]!;
    const cur = slices[i]!;
    cur.fromBeat = Math.min(beatCount, prev.toBeat + 1);
    if (cur.toBeat < cur.fromBeat) cur.toBeat = cur.fromBeat;
  }
  const last = slices[slices.length - 1];
  if (last) last.toBeat = beatCount;
  if (slices.length > 1 && last) {
    const tailPages = last.toPage - last.fromPage + 1;
    if (tailPages < 2 && last.toBeat !== last.fromBeat) {
      const prev = slices[slices.length - 2]!;
      prev.toPage = last.toPage;
      prev.toBeat = last.toBeat;
      slices.pop();
    }
  }
  return slices;
}

function parseModelJson<T>(raw: string): T {
  const cleaned = raw.replace(/^```(?:json)?\s*|```$/g, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new Error('Текстовая модель вернула план не в формате JSON. Нажмите «Создать план» ещё раз.');
  }
}

function difficultyOf(value: string | undefined, age: string): LineDifficulty {
  if (value === 'easy' || value === 'medium' || value === 'detailed') return value;
  return age === '4-8' || age === '5-6' || age === '6-8' ? 'medium' : 'easy';
}

function problemsForSlice(ideas: RawIdea[], slice: Slice) {
  const problems: string[] = [];
  const expected = slice.toPage - slice.fromPage + 1;
  if (ideas.length !== expected) problems.push(`returned ${ideas.length} ideas, need exactly ${expected}`);
  const blob = ideas.map((idea) => `${idea.title ?? ''} ${idea.prompt ?? ''}`).join('\n');
  if (FILM_ONLY.test(blob)) problems.push('contains film-only names. Use the named public-domain text only.');
  const beatNumbers = ideas.map((idea) => Number(idea.beat));
  const span = slice.toBeat - slice.fromBeat + 1;
  if (beatNumbers.some((beat) => !Number.isInteger(beat) || beat < slice.fromBeat || beat > slice.toBeat)) {
    problems.push(`every idea needs an integer beat from ${slice.fromBeat} to ${slice.toBeat}`);
  } else if (ideas.length) {
    for (let i = 1; i < beatNumbers.length; i++) {
      if (beatNumbers[i]! < beatNumbers[i - 1]!) problems.push(`beat order goes backwards at page ${slice.fromPage + i}`);
    }
    if (beatNumbers[0] !== slice.fromBeat) problems.push(`first page of this part must be beat ${slice.fromBeat}`);
    if (beatNumbers[beatNumbers.length - 1] !== slice.toBeat) problems.push(`last page of this part must be beat ${slice.toBeat}`);
    const present = new Set(beatNumbers);
    if (expected >= span) {
      const missing: number[] = [];
      for (let beat = slice.fromBeat; beat <= slice.toBeat; beat++) if (!present.has(beat)) missing.push(beat);
      if (missing.length) problems.push(`missing canon beats: ${missing.join(', ')}`);
    }
  }
  const prompts = ideas.map((idea) => String(idea.prompt ?? '').trim().toLowerCase());
  for (let i = 1; i < prompts.length; i++) {
    if (prompts[i] && prompts[i] === prompts[i - 1]) problems.push(`pages ${slice.fromPage + i - 1} and ${slice.fromPage + i} repeat the same picture`);
  }
  if (ideas.some((idea) => !String(idea.title ?? '').trim() || !String(idea.prompt ?? '').trim())) {
    problems.push('every idea needs a title and a prompt');
  }
  if (/\bcoloring scene\b/i.test(blob)) problems.push('filler scenes are not allowed');
  return problems;
}

const expandSystem = `You turn canon story beats into consecutive coloring-page ideas. Return valid JSON only, no markdown.
Schema: {"ideas":[{"title":"short English title","prompt":"one visual moment in English","difficulty":"easy|medium|detailed","beat":1}]}
Rules:
- Use only the numbered beats you are given, in that order. Do not add events, gardens, portraits, patterns, or moods that are not in those beats.
- Do not import a film, musical, or another author's version.
- Each page is the next moment of the story. Do not draw the same moment twice. Do not replace a plot event with a decorative picture.
- If there are more pages than beats, split a beat into consecutive seconds (the setup, then the action). The later prompt must show a visible change.
- If there are fewer pages than beats, merge neighboring beats, but the first page must use the first given beat and the last page must use the last given beat.
- When there are at least as many pages as beats, every given beat number appears at least once.
- title: short English scene name. Do not use a famous character name or a film name.
- prompt: one colorable scene. Call characters by role. No famous character names. No film-only names. An animal stays that animal in the costume from the character list. Do not redraw a cat, wolf, pig, or bird as a girl or a round mascot.
- cast: an array of character ids who are actually visible in this picture, chosen only from the character list in the request. Use the costume id that matches the clothes worn in this moment. Leave cast empty when the picture has none of those characters. Do not include a character who is only mentioned, not shown.
- The image model rejects child distress. Never write child, little girl, girl, rags, ashes, cinders, dirt, crying, tears, cruel, poor, humble, servant, hunger, or punishment. The heroine is a young woman in a clean simple dress. Chores are calm. The cottage is neat.
- The request names an age budget. The prompt may mention only the characters, the action, and the backdrop that budget allows. Do not describe a room, a floor, furniture, brick courses, or a crowd when the budget forbids them.
- No text inside the picture. difficulty is medium, or easy when the scene is a single large object.`;

async function expandSlice(options: {
  theme: string;
  age: string;
  source: string;
  beats: string[];
  slice: Slice;
  characters: TaleCharacter[];
}) {
  const { slice, beats } = options;
  const count = slice.toPage - slice.fromPage + 1;
  const listed = beats.slice(slice.fromBeat - 1, slice.toBeat).map((beat, index) => `${slice.fromBeat + index}. ${beat}`).join('\n');
  const ask = (problems?: string[]) => chat(
    expandSystem,
    `Tale: ${options.theme}. Source, the only allowed plot: ${options.source}. Ages ${options.age}.
Visual budget for every page: ${ageBudget(options.age)}
Write ideas for pages ${slice.fromPage}–${slice.toPage} only (${count} ideas).
Cover beats ${slice.fromBeat}–${slice.toBeat} in order:
${listed}
Character ids for cast: ${options.characters.map((person) => person.sameFaceAs ? `${person.id} (same face as ${person.sameFaceAs}, different costume)` : person.id).join(', ') || 'none'}.
${problems?.length ? `The previous list was rejected: ${problems.join('; ')}. Return a corrected full list of exactly ${count} ideas.` : `Return exactly ${count} ideas.`}`,
    0.2,
  );
  let ideas: RawIdea[] = [];
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await ask(attempt === 0 ? undefined : problems);
    try {
      const parsed = parseModelJson<{ ideas?: RawIdea[] }>(raw);
      ideas = Array.isArray(parsed.ideas) ? parsed.ideas : [];
    } catch (error) {
      problems = [error instanceof Error ? error.message : 'JSON parse failed'];
      ideas = [];
      continue;
    }
    problems = problemsForSlice(ideas, slice);
    if (!problems.length) return ideas;
  }
  throw new Error(`План сказки не держит сюжет (${problems.join('; ')}). Нажмите «Создать план» ещё раз.`);
}

async function outlineTale(theme: string, age: string) {
  const raw = await chat(
    `You are a story editor for a children's coloring book. You do not invent plot. Return valid JSON only, no markdown.
Schema: {"source":"Author, Title, year","beats":["one plot event"]}
Rules:
- Choose ONE public-domain text and name it in source. Never mix two authors. Never use a film, musical, or picture-book retelling.
- beats are the plot events in reading order, 12 to 40 of them. One event each.
- Begin at the tale's real opening and end at its real ending.
- Do not add portraits, patterns, gardens, or "the heroine smiling" unless that is itself a plot event.
- Do not use film-only names.
- Phrase violent literary events as the story fact without injury or blood.`,
    `Theme: ${theme}. Audience ages ${age}. List the canon beats of the single public-domain tale that this theme names. If several public-domain texts exist, pick the best-known gentle one and name it.`,
    0.2,
  );
  const parsed = parseModelJson<{ source?: string; beats?: unknown }>(raw);
  const source = String(parsed.source ?? '').trim();
  const beats = Array.isArray(parsed.beats) ? parsed.beats.map((beat) => String(beat).trim()).filter(Boolean) : [];
  if (!source || beats.length < 8 || beats.length > 40) {
    throw new Error('Модель не назвала первоисточник и порядок событий. Нажмите «Создать план» ещё раз.');
  }
  if (FILM_ONLY.test(`${source}\n${beats.join('\n')}`)) {
    throw new Error('План подмешал имена из фильма. Нажмите «Создать план» ещё раз.');
  }
  return { source, beats };
}

function asIdea(title: string, prompt: string, difficulty: string | undefined, index: number, age: string, cast?: string[]): BookPlanIdea {
  const allowed = (cast ?? []).map((id) => id.trim()).filter(Boolean);
  return {
    title: title.trim().slice(0, 100),
    prompt: prompt.trim().slice(0, 1200),
    difficulty: difficultyOf(difficulty, age),
    index,
    ...(allowed.length ? { cast: allowed } : {}),
  };
}

function castIds(value: unknown, allowed: Set<string>) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return list.map((id) => String(id).trim()).filter((id) => allowed.has(id));
}

async function designCharacters(theme: string, age: string, source: string, beats: string[]): Promise<TaleCharacter[]> {
  const raw = await chat(
    `You design reusable character sheets for a children's coloring book. Return valid JSON only, no markdown.
Schema: {"characters":[{"id":"short-slug","label":"who this reference picture is","prompt":"one character alone, full body, facing forward","sameFaceAs":""}]}
Rules:
- 2 to 8 characters. One picture is one character alone.
- If the tale's hero is an animal, that character is that animal, not a human and not a girl. Name the species in the prompt. An upright cat keeps a cat body: ears, muzzle, whiskers, paws, and a tail, and wears the story costume on that body (boots, a short cape, and a hat with one feather) when the tale gives him those clothes. Male when the tale's hero is male. Do not describe a round kitten face, a bow, a doll head, or a human girl with cat ears.
- A different costume of the SAME character is a separate id. Set sameFaceAs to the first id and say in the prompt to keep Image 1's face and species and change only the clothes. Do this only when the source tale actually changes that character's clothes.
- Characters who are not the same individual must not use sameFaceAs. Make fur or hair, and clothes, visibly different.
- ids are lowercase english slugs. label is one short sentence naming the character and the costume, with no famous name.
- prompt: storybook coloring-page line art, the same drawing level as a printed fairy-tale page. Name the species, sex, posture, and costume. Never a realistic portrait, never a blank face, never a baby face, never huge round eyes, never a mascot head.
- Human characters are grown. Do not describe a child in hardship, rags, ashes, or tears.`,
    `Tale: ${theme}. Source: ${source}. Ages ${age}. Plot, in order: ${beats.join(' | ')}. List only the people who recur or must look the same on more than one page.`,
    0.2,
  );
  const parsed = parseModelJson<{ characters?: { id?: string; label?: string; prompt?: string; sameFaceAs?: string }[] }>(raw);
  const rows = Array.isArray(parsed.characters) ? parsed.characters : [];
  const characters: TaleCharacter[] = [];
  const ids = new Set<string>();
  for (const row of rows) {
    const id = String(row.id ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    const prompt = String(row.prompt ?? '').trim();
    if (!id || !prompt || ids.has(id)) continue;
    ids.add(id);
    characters.push({
      id,
      label: String(row.label ?? id).trim() || id,
      prompt,
      sameFaceAs: String(row.sameFaceAs ?? '').trim().toLowerCase(),
    });
    if (characters.length >= 8) break;
  }
  return characters.map((person) => (
    person.sameFaceAs && ids.has(person.sameFaceAs) && person.sameFaceAs !== person.id
      ? person
      : { id: person.id, label: person.label, prompt: person.prompt }
  ));
}

/** Markdown table from a chat, or the factory's own title | prompt | difficulty lines. */
export function parseStoryboard(text: string, age = '4-8'): BookPlanIdea[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  const table = lines.filter((line) => line.startsWith('|') && !/^\|\s*:?-{3,}/.test(line));
  if (table.length >= 2) {
    const ideas: BookPlanIdea[] = [];
    for (const row of table) {
      const cells = row.split('|').map((cell) => cell.trim()).filter(Boolean);
      if (cells.length < 3) continue;
      if (/^(#|scene title|illustration description|difficulty)$/i.test(cells[0] ?? '') || /scene title/i.test(cells[1] ?? '')) continue;
      const numbered = /^\d+$/.test(cells[0] ?? '');
      const title = numbered ? cells[1] ?? '' : cells[0] ?? '';
      const prompt = numbered ? cells[2] ?? '' : cells[1] ?? '';
      const difficulty = numbered ? cells[3] : cells[2];
      const cast = String((numbered ? cells[4] : cells[3]) ?? '').split(',').map((id) => id.trim()).filter(Boolean);
      if (!title || !prompt) continue;
      ideas.push(asIdea(title, prompt, difficulty, ideas.length + 1, age, cast));
    }
    if (ideas.length) return ideas;
  }
  return lines.map((line, index) => {
    const parts = line.split('|').map((part) => part.trim());
    const cast = (parts[3] ?? '').split(',').map((id) => id.trim()).filter(Boolean);
    return asIdea(parts[0] || `Page ${index + 1}`, parts[1] || parts[0] || '', parts[2], index + 1, age, cast);
  }).filter((idea) => idea.prompt.length >= 3);
}

export async function createTalePlan(theme: string, age: string, count: number) {
  if (count < 8) throw new Error('Для сказки по порядку нужно хотя бы 8 страниц, иначе сюжет некуда разложить.');
  const locked = await outlineTale(theme, age);
  const characters = await designCharacters(theme, age, locked.source, locked.beats);
  const allowed = new Set(characters.map((person) => person.id));
  const slices = taleSlices(count, locked.beats.length);
  const rawIdeas: RawIdea[] = [];
  for (const slice of slices) {
    rawIdeas.push(...await expandSlice({ theme, age, source: locked.source, beats: locked.beats, slice, characters }));
  }
  if (rawIdeas.length !== count) {
    throw new Error(`План собрал ${rawIdeas.length} кадров вместо ${count}. Нажмите «Создать план» ещё раз.`);
  }
  return {
    mode: 'tale' as const,
    theme,
    age,
    count,
    source: locked.source,
    characters,
    ideas: rawIdeas.map((idea, index) => asIdea(String(idea.title ?? ''), String(idea.prompt ?? ''), idea.difficulty, index + 1, age, castIds(idea.cast, allowed))),
  };
}
