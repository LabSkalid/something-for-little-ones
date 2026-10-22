import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const GS_CANDIDATES = [
  process.env.GS_PATH,
  process.env.GHOSTSCRIPT,
  'gswin64c',
  'gswin32c',
  'gs',
  'C:\\Program Files\\gs\\gs10.04.0\\bin\\gswin64c.exe',
  'C:\\Program Files\\gs\\gs10.03.1\\bin\\gswin64c.exe',
  'C:\\Program Files\\gs\\gs10.02.1\\bin\\gswin64c.exe',
  'C:\\Program Files\\gs\\gs9.56.1\\bin\\gswin64c.exe',
  'C:\\Program Files (x86)\\gs\\gs8.64\\bin\\gswin32c.exe',
  'C:\\Program Files\\gs\\gs8.64\\bin\\gswin64c.exe',
].filter(Boolean) as string[];

let cachedGs: string | null | undefined;

async function pathExists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Resolve Ghostscript CLI once (needed for correct RGB from design-tool PDF covers). */
export async function findGhostscript(): Promise<string | null> {
  if (cachedGs !== undefined) return cachedGs;
  for (const candidate of GS_CANDIDATES) {
    if (path.isAbsolute(candidate) || candidate.includes('\\') || candidate.includes('/')) {
      if (await pathExists(candidate)) {
        cachedGs = candidate;
        return cachedGs;
      }
      continue;
    }
    try {
      await execFileAsync(candidate, ['-v'], { windowsHide: true });
      cachedGs = candidate;
      return cachedGs;
    } catch {
      // try next
    }
  }
  cachedGs = null;
  return null;
}

/**
 * Rasterize page 1 of a PDF to an sRGB PNG via Ghostscript.
 * Design exports often tag bitmaps DeviceCMYK even when the file was “saved as RGB”;
 * extracting that JPEG + sharp yields inverted / wrong colors. GS matches Preview/Acrobat.
 */
export async function rasterizePdfFirstPagePng(
  pdfFile: string,
  dpi = 200,
): Promise<Buffer | null> {
  const gs = await findGhostscript();
  if (!gs) return null;

  const resolved = path.resolve(pdfFile);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kids-pdf-cover-'));
  const outPng = path.join(tmpDir, 'page.png');
  try {
    await execFileAsync(
      gs,
      [
        '-dSAFER',
        '-dBATCH',
        '-dNOPAUSE',
        '-dQUIET',
        '-sDEVICE=png16m',
        `-r${Math.max(72, Math.round(dpi))}`,
        '-dFirstPage=1',
        '-dLastPage=1',
        '-dTextAlphaBits=4',
        '-dGraphicsAlphaBits=4',
        `-sOutputFile=${outPng}`,
        resolved,
      ],
      { windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
    );
    return await fs.readFile(outPng);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Ghostscript не смог растеризовать обложку (${path.basename(resolved)}): ${message}`);
    return null;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
