import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const themes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/themes' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    tagline: z.string(),
    kind: z.enum(['evergreen', 'seasonal']),
    ageBand: z.enum(['2-3', '3-4', '4-5', '5-6', '6-8']),
    order: z.number(),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    ink: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    related: z.array(z.string()),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date(),
    keywords: z.array(z.string()),
    faqs: z.array(
      z.object({
        question: z.string(),
        answer: z.string(),
      }),
    ),
    pins: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        subtitle: z.string(),
      }),
    ),
  }),
});

const sheets = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: './src/content/sheets',
    // Filenames repeat across themes (family-car, fire-truck). The page URL uses theme + slug from frontmatter.
    generateId: ({ entry }) => entry.replace(/\\/g, '/').replace(/\.md$/, ''),
  }),
  schema: z.object({
    title: z.string(),
    theme: z.string(),
    slug: z.string(),
    description: z.string(),
    alt: z.string(),
    parentNote: z.string(),
    order: z.number(),
    difficulty: z.enum(['toddler', 'easy', 'medium', 'detailed']),
    age: z.string(),
  }),
});

export const collections = { themes, sheets };
