import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

const SCALE = 3; // 216 dpi: mantém texto e QR Code nítidos na térmica de 203 dpi.

export function limitesConteudo({ data, width, height }: Pick<ImageData, 'data' | 'width' | 'height'>) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (data[index + 3] && (data[index] < 250 || data[index + 1] < 250 || data[index + 2] < 250)) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return right < 0 ? null : { left, top, right, bottom };
}

/** Renderiza o original localmente e remove apenas bordas vazias da cópia impressa. */
export async function pdfParaHtmlTermico(pdf: Blob): Promise<string> {
  const loading = getDocument({ data: new Uint8Array(await pdf.arrayBuffer()), useSystemFonts: true, stopAtErrors: true });
  const images: string[] = [];
  try {
    const documentPdf = await loading.promise;
    for (let number = 1; number <= documentPdf.numPages; number += 1) {
      const page = await documentPdf.getPage(number);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Não foi possível preparar a imagem do documento fiscal.');
      await page.render({ canvas, canvasContext: context, viewport, background: '#ffffff', intent: 'print' }).promise;
      const bounds = limitesConteudo(context.getImageData(0, 0, canvas.width, canvas.height));
      if (bounds) {
        // Preserva uma borda branca ao redor do texto e a área livre do QR Code.
        const padding = Math.ceil(2 * 72 / 25.4 * SCALE);
        const x = Math.max(0, bounds.left - padding);
        const y = Math.max(0, bounds.top - padding);
        const width = Math.min(canvas.width, bounds.right + padding + 1) - x;
        const height = Math.min(canvas.height, bounds.bottom + padding + 1) - y;
        const cropped = document.createElement('canvas');
        cropped.width = width;
        cropped.height = height;
        const cropContext = cropped.getContext('2d');
        if (!cropContext) throw new Error('Não foi possível ajustar as margens do documento fiscal.');
        cropContext.drawImage(canvas, x, y, width, height, 0, 0, width, height);
        images.push(`<img src="${cropped.toDataURL('image/png')}" width="${width}" height="${height}" alt="Página ${number} do documento fiscal">`);
        cropped.width = cropped.height = 0;
      }
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  } finally {
    await loading.destroy();
  }
  if (!images.length) throw new Error('O documento fiscal não possui conteúdo visível para impressão.');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Documento fiscal</title><style>
    @page { size: auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { padding: 0; margin: 0; background: white; }
    body { width: 72mm; max-width: calc(100% - 8mm); margin: 0 auto; padding: 2mm; }
    img { display: block; width: 100%; height: auto; }
    img + img { margin-top: 1mm; }
  </style></head><body>${images.join('')}</body></html>`;
}
