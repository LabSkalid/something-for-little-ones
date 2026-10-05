import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.dirname(fileURLToPath(import.meta.url));

export const factoryRoot = path.resolve(srcDir, '..');
export const repoRoot = path.resolve(factoryRoot, '..');
export const siteRoot = path.join(repoRoot, 'site');
export const artRoot = path.join(factoryRoot, 'art');
export const briefsRoot = path.join(factoryRoot, 'briefs');
export const printRoot = path.join(siteRoot, 'public', 'print');
export const pinRoot = path.join(siteRoot, 'public', 'pins');
export const themeContentRoot = path.join(siteRoot, 'src', 'content', 'themes');
export const sheetContentRoot = path.join(siteRoot, 'src', 'content', 'sheets');
