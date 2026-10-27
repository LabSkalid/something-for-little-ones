/** Build a short, parent-facing collection footer from the actual sheet titles.
 * Never invent animals, objects, scenes, or other contents that are not in the collection.
 */
export function buildThemeBody(collectionTitle: string, sheetTitles: string[]): string {
  const subject = collectionTitle
    .replace(/\s+coloring pages?\s*$/i, '')
    .trim()
    .toLowerCase();

  const examples = [...new Set(
    sheetTitles
      .map((title) => title.replace(/\s+coloring page\s*$/i, '').trim())
      .filter(Boolean),
  )].slice(0, 3);

  let description: string;
  if (examples.length >= 2) {
    const exampleList = examples.length === 2
      ? `${examples[0]} and ${examples[1]}`
      : `${examples[0]}, ${examples[1]}, and ${examples[2]}`;
    description = `This collection features ${subject} coloring pages, with designs such as ${exampleList}.`;
  } else if (examples.length === 1) {
    description = `This collection features ${subject} coloring pages, with a design such as ${examples[0]}.`;
  } else {
    description = `This collection features printable ${subject} coloring pages.`;
  }

  return `${description}\n\nDownload the PDF, not a screenshot of this page.`;
}
