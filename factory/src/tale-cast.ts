import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { coloringPrompt, generateColoringPage } from './openrouter.ts';

/** Tale pages need a model that keeps a face across a new scene. Variety books stay on the factory default. */
export const TALE_IMAGE_MODEL = 'openai/gpt-image-2.6-sunburst';

export type TaleCharacter = {
  id: string;
  label: string;
  prompt: string;
  sameFaceAs?: string;
};

export function normalizeCharacters(value: unknown): TaleCharacter[] {
  if (!Array.isArray(value)) return [];
  const characters: TaleCharacter[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as TaleCharacter;
    const id = String(row.id ?? '').trim();
    const prompt = String(row.prompt ?? '').trim();
    if (!id || !prompt) continue;
    const sameFaceAs = String(row.sameFaceAs ?? '').trim();
    characters.push({
      id,
      label: String(row.label ?? id).trim() || id,
      prompt,
      ...(sameFaceAs && sameFaceAs !== id ? { sameFaceAs } : {}),
    });
  }
  return characters;
}

export function sheetPrompt(person: TaleCharacter) {
  const cute = 'Cute children\'s coloring-book cartoon, big round eyes, a small friendly smile, simple shapes, not a realistic portrait.';
  if (person.sameFaceAs) {
    return `Image 1 is the same person. Keep the cute face and hair from Image 1. Change only the clothes. ${cute} ${person.prompt} One person, full body, facing forward, plain white background, no other people.`;
  }
  return `${cute} ${person.prompt} One person, full body, facing forward, plain white background, no other people.`;
}

export function referenceNote(ids: string[], people: TaleCharacter[]) {
  if (!ids.length) return 'Draw only the people this moment names. Do not add anyone who is not named.';
  const listed = ids.map((id, index) => {
    const person = people.find((item) => item.id === id);
    return `Image ${index + 1} is ${person?.label || id}. Keep this person's cute cartoon face, hair, and clothes.`;
  }).join(' ');
  return `${listed} Draw one new coloring-book moment. Change the pose and the place. Do not copy the empty background. Draw only the people whose pictures are attached. Keep the small smile unless this moment says the person is alarmed or stern.`;
}

function ordered(people: TaleCharacter[]) {
  return [
    ...people.filter((person) => !person.sameFaceAs),
    ...people.filter((person) => person.sameFaceAs),
  ];
}

/** Draws only sheets that are not already files. Existing files stay as the user left them. */
export async function ensureTaleCast(castDir: string, people: TaleCharacter[], style: string, age: string) {
  await fs.mkdir(castDir, { recursive: true });
  let drew = false;
  for (const sheet of ordered(people)) {
    const file = path.join(castDir, `${sheet.id}.png`);
    try {
      await fs.access(file);
      console.log(`Образец уже есть, не трогаю: ${sheet.id}`);
      continue;
    } catch { /* draw the missing sheet */ }
    if (sheet.sameFaceAs) {
      try {
        await fs.access(path.join(castDir, `${sheet.sameFaceAs}.png`));
      } catch {
        throw new Error(`Не могу нарисовать «${sheet.id}»: сначала нужен образец «${sheet.sameFaceAs}».`);
      }
    }
    if (!drew) {
      drew = true;
      console.log('Рисую только недостающих героев. Уже сохранённые образцы не перерисовываю.');
    }
    console.log(`Образец: ${sheet.id}`);
    const references: Buffer[] = [];
    if (sheet.sameFaceAs) references.push(await fs.readFile(path.join(castDir, `${sheet.sameFaceAs}.png`)));
    const raw = await generateColoringPage(coloringPrompt(style, sheetPrompt(sheet), 'easy', age), references, TALE_IMAGE_MODEL);
    const small = await sharp(raw).resize({ width: 800, withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
    await fs.writeFile(file, small);
    console.log(`Сохранён образец: ${file}`);
  }
  if (!drew) console.log('Все образцы уже лежат в папке. Новых рисунков не было.');
}

/** Deletes one sheet and the costumes that copy its face, then draws those files again. */
export async function redrawTaleCast(castDir: string, people: TaleCharacter[], id: string, style: string, age: string) {
  const known = new Set(people.map((person) => person.id));
  if (!known.has(id)) throw new Error(`В плане нет героя «${id}». Курсор должен стоять в строке # character.`);
  const doomed = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const person of people) {
      if (person.sameFaceAs && doomed.has(person.sameFaceAs) && !doomed.has(person.id)) {
        doomed.add(person.id);
        grew = true;
      }
    }
  }
  await fs.mkdir(castDir, { recursive: true });
  for (const sheetId of doomed) await fs.rm(path.join(castDir, `${sheetId}.png`), { force: true });
  console.log(`Перерисовываю: ${[...doomed].join(', ')}. Остальные образцы не трогаю.`);
  await ensureTaleCast(castDir, people.filter((person) => doomed.has(person.id)), style, age);
}

export async function loadTaleCast(castDir: string, ids: string[]) {
  const images: Buffer[] = [];
  for (const id of ids) images.push(await fs.readFile(path.join(castDir, `${id}.png`)));
  return images;
}

export async function missingTaleCast(castDir: string, ids: string[]) {
  const missing: string[] = [];
  for (const id of ids) {
    try {
      await fs.access(path.join(castDir, `${id}.png`));
    } catch {
      missing.push(id);
    }
  }
  return missing;
}
