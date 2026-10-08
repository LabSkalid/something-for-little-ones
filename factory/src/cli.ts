import path from 'node:path';
import { buildAssets, buildPins } from './build-assets.ts';
import { produce } from './produce.ts';
import { redraw } from './redraw.ts';
import { factoryRoot } from './paths.ts';

const [command, ...rest] = process.argv.slice(2);

const help = `Фабрика раскрасок.

  npm run assets
      Собрать PNG, PDF и пины подборок из factory/art.

  npm run pins
      Собрать пины всех подборок из уже готовых PNG в site/public/print.
      Модель не вызывается. Рабочая папка: factory.
      Одна подборка:
      npm run pins -- halloween-coloring-pages

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
      Открыть локальную страницу с двумя вкладками:
      сток PNG/SVG на сайт, и отдельно рисование/пины.
      Удобнее запускать файлом Open Factory.bat (без npm run).

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
    await buildPins(theme);
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
  console.log(help);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
