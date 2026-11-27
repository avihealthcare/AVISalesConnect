import { copyFile, mkdir } from 'node:fs/promises';

const target = new URL('../apps/web/public/card-ocr/', import.meta.url);
await mkdir(target, { recursive: true });
const assets = {
  'worker.min.js': 'tesseract.js/dist/worker.min.js',
  'worker.min.js.LICENSE.txt': 'tesseract.js/dist/worker.min.js.LICENSE.txt',
  'tesseract-js-LICENSE.txt': 'tesseract.js/LICENSE.md',
  'tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
  'tesseract-core-lstm.wasm': 'tesseract.js-core/tesseract-core-lstm.wasm',
  'tesseract-core-LICENSE.txt': 'tesseract.js-core/LICENSE',
  'eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};
await Promise.all(Object.entries(assets).map(([name, source]) =>
  copyFile(new URL('../node_modules/' + source, import.meta.url), new URL(name, target))));
