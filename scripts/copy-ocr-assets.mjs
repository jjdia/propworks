// Copies tesseract.js worker, wasm core and English lang data into
// public/ocr/ so OCR is self-hosted under the Pages base (issue #14).
// Runs before dev/build; public/ocr is gitignored (comes from node_modules).
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
const out = 'public/ocr';
mkdirSync(out, { recursive: true });
cpSync('node_modules/tesseract.js/dist/worker.min.js', `${out}/worker.min.js`);
for (const f of readdirSync('node_modules/tesseract.js-core')) {
  if (/lstm\.wasm\.js$/.test(f)) cpSync(`node_modules/tesseract.js-core/${f}`, `${out}/${f}`);
}
cpSync('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', `${out}/eng.traineddata.gz`);
console.log('OCR assets copied to', out);
