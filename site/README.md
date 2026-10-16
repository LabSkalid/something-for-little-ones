# Something for Little Ones — site

Astro site for free printable coloring pages.

## Commands

From `site/`:

| Command | Action |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Local server at `localhost:4321` |
| `npm run build` | Production build to `./dist/` |
| `npm run preview` | Preview the production build |

## Seasonal homepage strip — `src/lib/seasons.ts`

The homepage shows a **This season** block (theme cards under the intro) based on today’s calendar date at **build/deploy** time. Edit only this file to change windows or featured themes.

### What to put in a window

Each entry in `seasonWindows` needs:

| Field | Meaning |
| --- | --- |
| `id` | Short key (`fall`, `winter`, `valentine`, …) |
| `label` | Section heading (`This fall`, `This winter`) |
| `blurb` | One short line under the heading |
| `themeIds` | Theme folder ids from `src/content/themes/` (e.g. `halloween-coloring-pages`) |
| `start` / `end` | Inclusive `{ month, day }` (1-based month). May wrap the year (Dec → Jan) |

Windows are checked **in array order**; the first match with a **non-empty** `themeIds` list wins. If `themeIds` is `[]`, that season is reserved but **hidden** until you add real theme ids.

### Current calendar

| Window | Dates | Themes |
| --- | --- | --- |
| Valentine’s | Feb 1–16 | *(empty — add when ready)* |
| Spring | Mar 1 – May 15 | *(empty — Easter etc.)* |
| Summer | Jun 1 – Aug 20 | *(empty — beach/ocean seasonal if needed)* |
| Fall | Sep 1 – Nov 30 | Fall, Halloween, Thanksgiving |
| Winter | Dec 1 – Jan 31 | Winter, Christmas, Christian Christmas |

### When a new holiday set is ready

1. Create the theme under `src/content/themes/` (and sheets as usual).
2. Open `src/lib/seasons.ts`.
3. Find the right window (or add one) and put the theme id in `themeIds` in the order you want cards to appear.
4. Adjust `label` / `blurb` / dates if needed.
5. Deploy — the strip updates on the next build (static site: date is fixed at build time).

Example — turning on Valentine’s once the set exists:

```ts
{
  id: 'valentine',
  label: 'Valentine’s Day',
  blurb: 'Sweet printable pages for February.',
  themeIds: ['valentine-coloring-pages'],
  start: { month: 2, day: 1 },
  end: { month: 2, day: 16 },
},
```

The full holiday catalog stays lower on the homepage (`#holidays`); this file only controls the **spotlight** near the top.
