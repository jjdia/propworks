// Client-side document text extraction (issue #14). Everything runs in the
// browser; no document bytes go to any server. pdf.js and tesseract.js are
// dynamically imported so they stay out of the main bundle. Tesseract's
// worker, wasm core and English data are self-hosted under <base>/ocr/.

export type ExtractProgress = (msg: string) => void;

const ocrBase = () => new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.href).toString();

async function loadPdf(file: File) {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
}

async function ocrImages(images: (Blob | HTMLCanvasElement)[], progress?: ExtractProgress): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  progress?.('Loading OCR (first time ~3 MB, then cached)…');
  const base = ocrBase();
  const worker = await createWorker('eng', 1, { workerPath: `${base}worker.min.js`, corePath: base, langPath: base.replace(/\/$/, ''), gzip: true });
  try {
    const parts: string[] = [];
    for (let i = 0; i < images.length; i++) {
      progress?.(`Reading page ${i + 1} of ${images.length}…`);
      const { data } = await worker.recognize(images[i]);
      parts.push(data.text);
    }
    return parts.join('\n');
  } finally {
    await worker.terminate();
  }
}

/** Extract text from a PDF (text layer first, OCR fallback for scans) or an image. */
export async function extractText(file: File, progress?: ExtractProgress, maxPages = 6): Promise<{ text: string; method: 'pdf-text' | 'ocr' }> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) return { text: await ocrImages([file], progress), method: 'ocr' };

  progress?.('Reading PDF…');
  const pdf = await loadPdf(file);
  const n = Math.min(pdf.numPages, maxPages);
  const pages: string[] = [];
  for (let p = 1; p <= n; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const it of tc.items as { str?: string; hasEOL?: boolean }[]) {
      line += it.str ?? '';
      if (it.hasEOL) { lines.push(line); line = ''; } else if (it.str) line += ' ';
    }
    if (line) lines.push(line);
    pages.push(lines.join('\n'));
  }
  const text = pages.join('\n');
  if (text.replace(/\s/g, '').length >= 40) return { text, method: 'pdf-text' };

  // Scanned PDF: render pages to canvas, then OCR.
  progress?.('No text layer — scanning pages…');
  const canvases: HTMLCanvasElement[] = [];
  for (let p = 1; p <= n; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
    canvases.push(canvas);
  }
  return { text: await ocrImages(canvases, progress), method: 'ocr' };
}
