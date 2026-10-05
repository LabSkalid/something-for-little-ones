export const ageBands = [
  {
    id: '2-3',
    label: 'Ages 2–3',
    blurb: 'A few huge shapes. Useful when a child still scribbles across the page and is done in a minute or two.',
  },
  {
    id: '3-4',
    label: 'Ages 3–4',
    blurb: 'Thick outlines and big areas, with a few smaller parts. Animals, dinosaurs, cars, princesses, and the holiday sets live here.',
  },
  {
    id: '4-5',
    label: 'Ages 4–5',
    blurb: 'A simple scene with more separate regions, for a child who wants the picture to look finished.',
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
