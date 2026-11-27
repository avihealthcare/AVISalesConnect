import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { readCardFields } from './cardText';

export async function extractCardFields(sides: Blob[], onSide: (side: number, total: number) => void) {
  const assets = new URL('/card-ocr/', window.location.origin);
  let worker: Worker | undefined;
  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const failed = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('OCR timed out')), 60_000);
  });
  const extract = async () => {
    const started = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: new URL('worker.min.js', assets).href,
      corePath: new URL('tesseract-core-lstm.wasm.js', assets).href,
      langPath: assets.href,
      workerBlobURL: false,
      errorHandler: () => undefined,
    });
    if (stopped) {
      await started.terminate();
      throw new Error('OCR stopped');
    }
    worker = started;
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const lines = [];
    for (const [index, side] of sides.entries()) {
      onSide(index + 1, sides.length);
      const { data } = await worker.recognize(side, {}, { blocks: true });
      lines.push((data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph =>
        paragraph.lines.map(line => ({ text:line.text,confidence:line.confidence })))));
    }
    return readCardFields(lines);
  };
  try {
    return await Promise.race([extract(), failed]);
  } finally {
    stopped = true;
    clearTimeout(timeout);
    await worker?.terminate();
  }
}
