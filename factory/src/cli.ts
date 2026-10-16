import path from 'node:path';
import { buildAssets, buildPins, writePinCopyOnly } from './build-assets.ts';
import { buildKdpBook } from './kdp-book.ts';
import { buildDownloadPdfFromKdp } from './kdp-download-from-pdf.ts';
import { produce } from './produce.ts';
import { redraw } from './redraw.ts';
import { factoryRoot } from './paths.ts';

const [command, ...rest] = process.argv.slice(2);

const help = `Фабрика раскрасок.

  npm run assets
      Собрать PNG, PDF и пины подборок из factory/art.

  npm run pins
      Собрать пины из уже готовых PNG. Картинки бесплатные.
      Текст для Pinterest — только с флагом --copy (дешёвая текстовая модель).
      Одна подборка:
      npm run pins -- halloween-coloring-pages
      Только бандлы:
      npm run pins -- halloween-coloring-pages --mode=collection
      С текстом (при сборке картинок):
      npm run pins -- halloween-coloring-pages --mode=collection --copy --keywords="thanksgiving, turkey"
      Только тексты, без перерисовки PNG (по умолчанию заполняет пустые поля):
      npm run pins -- halloween-coloring-pages --copy-only --keywords="fall coloring pages"
      Перезаписать уже написанные тексты:
      npm run pins -- halloween-coloring-pages --copy-only --overwrite
      Цвет FREE PRINTABLE (и рамок бандла):
      npm run pins -- christmas-coloring-pages --accent=#1d7ad6

  npm run produce -- briefs/animal-coloring-pages.yaml
      По заданию дорисовать новые страницы и положить их на сайт.
      Уже существующие страницы не перезаписываются.

  npm run produce -- briefs/animal-coloring-pages.yaml --dry-run
      Показать, какие страницы ещё не на сайте, без запросов к модели.

  npm run redraw
      Заново нарисовать уже опубликованные листы через OpenRouter.
      Тексты и пины не меняются. Можно указать одну тему:
      npm run redraw -- animal-coloring-pages

  npm run studio
      Открыть локальную страницу: сток, рисование/пины, книга Amazon KDP.
      Удобнее запускать файлом Open Factory.bat (без npm run).

  npm run kdp -- --folder="D:\\COLORING\\Garden\\SVG" --title="Adorable Garden Coloring Book"
      Собрать один PDF интерьера для Amazon KDP (8.5×11, без bleed, без футера сайта).
      Опции: --author=Name --no-blanks --no-front --out=path.pdf
      PDF для скачивания / печати дома (без пустых страниц, с обложками) из папки рисунков:
      npm run kdp -- --download --folder="..." --title="..." --front-cover=front.pdf --back-cover=back.pdf
      Из готового KDP PDF (убрать пустые страницы, добавить обложки — папка рисунков не нужна):
      npm run kdp -- --from-pdf="D:\\...\\book.pdf" --front-cover=front.pdf --back-cover=back.pdf
      Обложки: PNG/JPG/SVG/PDF (у PDF берётся первая страница).

Ключ один: factory/.env с OPENROUTER_API_KEY.
Картинки: OPENROUTER_IMAGE_MODEL (по умолчанию openai/gpt-image-2).
Текст: OPENROUTER_TEXT_MODEL (по умолчанию google/gemini-2.5-flash).
Vision для названий стока: OPENROUTER_VISION_MODEL
(по умолчанию тот же текстовый).
Адрес внизу листа берётся из site/src/site.ts.
`;

async function main() {
  if (command === 'assets') {
    await buildAssets();
    return;
  }
  if (command === 'pins') {
    const theme = rest.find((arg) => !arg.startsWith('--'));
    const modeArg = rest.find((arg) => arg.startsWith('--mode='))?.slice('--mode='.length);
    const keywords = rest.find((arg) => arg.startsWith('--keywords='))?.slice('--keywords='.length) ?? '';
    const mode =
      modeArg === 'collection' || modeArg === 'single' || modeArg === 'both' ? modeArg : 'both';
    if (rest.includes('--copy-only')) {
      await writePinCopyOnly({
        theme,
        mode,
        keywords,
        overwrite: rest.includes('--overwrite'),
      });
      return;
    }
    const accentArg = rest.find((arg) => arg.startsWith('--accent='))?.slice('--accent='.length);
    await buildPins({
      theme,
      mode,
      writeCopy: rest.includes('--copy'),
      keywords,
      removeOld: rest.includes('--remove-old'),
      framed: !rest.includes('--no-frames'),
      collectionCount: Number(rest.find((arg) => arg.startsWith('--count='))?.slice('--count='.length) ?? 2) || 2,
      accent: accentArg && /^#[0-9a-fA-F]{6}$/i.test(accentArg) ? accentArg : undefined,
    });
    return;
  }
  if (command === 'redraw') {
    const theme = rest.find((arg) => !arg.startsWith('--'));
    await redraw(theme);
    return;
  }
  if (command === 'produce') {
    const brief = rest.find((arg) => !arg.startsWith('--'));
    if (!brief) {
      console.log(help);
      process.exit(1);
    }
    const briefPath = path.isAbsolute(brief) ? brief : path.join(factoryRoot, brief);
    await produce(briefPath, rest.includes('--dry-run'));
    return;
  }
  if (command === 'kdp') {
    const fromPdf = rest.find((arg) => arg.startsWith('--from-pdf='))?.slice('--from-pdf='.length);
    const frontCover = rest.find((arg) => arg.startsWith('--front-cover='))?.slice('--front-cover='.length);
    const backCover = rest.find((arg) => arg.startsWith('--back-cover='))?.slice('--back-cover='.length);
    const outFile = rest.find((arg) => arg.startsWith('--out='))?.slice('--out='.length);
    if (fromPdf) {
      await buildDownloadPdfFromKdp({
        pdfFile: fromPdf,
        frontCover,
        backCover,
        outFile,
      });
      return;
    }
    const folder = rest.find((arg) => arg.startsWith('--folder='))?.slice('--folder='.length);
    const title = rest.find((arg) => arg.startsWith('--title='))?.slice('--title='.length);
    if (!folder || !title) {
      console.log(help);
      process.exit(1);
    }
    const download = rest.includes('--download');
    await buildKdpBook({
      folder,
      title,
      subtitle: rest.find((arg) => arg.startsWith('--subtitle='))?.slice('--subtitle='.length),
      author: rest.find((arg) => arg.startsWith('--author='))?.slice('--author='.length),
      copyright: rest.find((arg) => arg.startsWith('--copyright='))?.slice('--copyright='.length),
      outFile,
      blankBacks: download ? false : !rest.includes('--no-blanks'),
      padEvenPages: download ? false : !rest.includes('--no-blanks'),
      frontMatter: download
        ? rest.includes('--front-matter')
        : !rest.includes('--no-front'),
      captions: !rest.includes('--no-captions'),
      frontCover,
      backCover,
    });
    return;
  }
  console.log(help);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
