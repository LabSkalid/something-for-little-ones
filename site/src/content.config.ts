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
  loader: glob({ pattern: '**/*.md', base: './src/content/sheets' }),
  schema: z.object({
    title: z.string(),
    theme: z.string(),
    slug: z.string(),
    description: z.string(),
    alt: z.string(),
    parentNote: z.string(),
    order: z.number(),
    difficulty: z.enum(['easy', 'medium']),
    age: z.string(),
  }),
});

export const collections = { themes, sheets };
