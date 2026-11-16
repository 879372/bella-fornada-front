import { beforeEach, describe, expect, it, vi } from 'vitest';
import { limitesConteudo, pdfParaHtmlTermico } from './pdfTermico';

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock('pdfjs-dist', () => ({ getDocument, GlobalWorkerOptions: { workerSrc: '' } }));

function image(width: number, height: number) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}
function pixel(pixels: ReturnType<typeof image>, x: number, y: number, color = [0, 0, 0, 255]) {
  pixels.data.set(color, (y * pixels.width + x) * 4);
}

describe('cópia térmica do documento fiscal', () => {
  beforeEach(() => { getDocument.mockReset(); vi.restoreAllMocks(); });

  it('detecta os limites sem perder texto claro, cores ou o QR Code no rodapé', () => {
    const pixels = image(300, 600);
    pixel(pixels, 50, 200);
    pixel(pixels, 249, 299, [249, 249, 249, 255]);
    pixel(pixels, 285, 410, [255, 100, 255, 255]);
    expect(limitesConteudo(pixels)).toEqual({ left: 50, top: 200, right: 285, bottom: 410 });
  });

  it('ignora branco e transparência, sem inventar conteúdo em páginas vazias', () => {
    const pixels = image(30, 60);
    pixel(pixels, 0, 0, [0, 0, 0, 0]);
    expect(limitesConteudo(pixels)).toBeNull();
    pixel(pixels, 0, 0);
    pixel(pixels, 29, 59);
    expect(limitesConteudo(pixels)).toEqual({ left: 0, top: 0, right: 29, bottom: 59 });
  });

  it('recorta as áreas vazias mantendo bordas de segurança e a proporção da imagem', async () => {
    const pixels = image(300, 600);
    pixel(pixels, 50, 200); pixel(pixels, 249, 299);
    const draw = vi.fn();
    const canvases: HTMLCanvasElement[] = [];
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(tag => {
      const element = originalCreate(tag);
      if (tag === 'canvas') {
        const canvas = element as HTMLCanvasElement;
        vi.spyOn(canvas, 'getContext').mockReturnValue({ getImageData: () => pixels, drawImage: draw } as unknown as CanvasRenderingContext2D);
        vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,aW1hZ2Vt');
        canvases.push(canvas);
      }
      return element;
    });
    const cleanup = vi.fn(); const destroy = vi.fn();
    getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getViewport: () => ({ width: 300, height: 600 }), render: () => ({ promise: Promise.resolve() }), cleanup }) }), destroy });
    const pdf = { arrayBuffer: async () => new ArrayBuffer(8) } as Blob;
    const html = await pdfParaHtmlTermico(pdf);
    expect(draw).toHaveBeenCalledWith(canvases[0], 32, 182, 236, 136, 0, 0, 236, 136);
    expect(html).toContain('width="236" height="136"');
    expect(html).toContain('width: 72mm');
    expect(html).toContain('height: auto');
    expect(cleanup).toHaveBeenCalledOnce(); expect(destroy).toHaveBeenCalledOnce();
  });
});
