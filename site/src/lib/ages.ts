export const ageBands = [
  {
    id: '2-3',
    label: 'Ages 2–3',
    blurb: 'A few huge shapes. Useful when a child still scribbles across the page and is done in a minute or two.',
  },
  {
    id: '3-4',
    label: 'Ages 3–4',
    blurb: 'Thick outlines and big areas, with a few smaller parts. Animals, dinosaurs, cars, and princesses are in this group.',
  },
  {
    id: '4-5',
    label: 'Ages 4–5',
    blurb: 'Chunky pictures with more parts than a toddler page. A garden scene or one big vehicle.',
  },
  {
    id: '5-6',
    label: 'Ages 5–6',
    blurb: 'Patterns and busier scenes that take a longer sitting.',
  },
  {
    id: '6-8',
    label: 'Ages 6–8',
    blurb: 'Fuller scenes and repeating patterns. The lines stay bold enough to color.',
  },
] as const;

export type AgeBandId = (typeof ageBands)[number]['id'];

export function ageBandLabel(id: string) {
  return ageBands.find((band) => band.id === id)?.label ?? `Ages ${id}`;
}

/** Label for a theme whose sheets span more than one age band, e.g. "Ages 2–8". */
export function ageSpanLabel(ages: Iterable<string>) {
  const present = ageBands.map((band) => band.id).filter((id) => new Set(ages).has(id));
  if (present.length === 0) return 'All ages';
  if (present.length === 1) return ageBandLabel(present[0]);
  const first = present[0].split('-')[0];
  const last = present[present.length - 1].split('-').at(-1);
  return `Ages ${first}–${last}`;
}
