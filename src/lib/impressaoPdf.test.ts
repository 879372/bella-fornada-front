import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imprimirPdf } from './impressao';

const { preparePdf } = vi.hoisted(() => ({ preparePdf: vi.fn() }));
vi.mock('./pdfTermico', () => ({ pdfParaHtmlTermico: preparePdf }));

function setupFrame() {
  const child = document.implementation.createHTMLDocument('Impressão');
  Object.defineProperty(child.body, 'scrollHeight', { value: 192 });
  const printer = { document: child, focus: vi.fn(), print: vi.fn(), addEventListener: vi.fn() };
  const frame = {
    style: { cssText: '' }, setAttribute: vi.fn(), contentWindow: printer, srcdoc: '',
    onload: null as (() => Promise<void>) | null, onerror: null as (() => void) | null,
    remove: vi.fn(),
  };
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(tag => tag === 'iframe' ? frame as unknown as HTMLIFrameElement : createElement(tag));
  const append = vi.spyOn(document.body, 'appendChild').mockImplementation(node => node);
  return { frame, printer, append };
}

describe('impressão do PDF fiscal', () => {
  beforeEach(() => {
    vi.useFakeTimers(); preparePdf.mockReset();
    preparePdf.mockResolvedValue('<html><body>PDF fiscal sem bordas vazias</body></html>');
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('prepara o fiscal e imprime com altura do conteúdo sem abrir outra aba', async () => {
    const { frame, printer, append } = setupFrame();
    const open = vi.spyOn(window, 'open');
    const printing = imprimirPdf(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    await vi.waitFor(() => expect(append).toHaveBeenCalledOnce());
    expect(printer.print).not.toHaveBeenCalled();
    await frame.onload?.();
    await printing;
    expect(frame.srcdoc).toContain('PDF fiscal sem bordas vazias');
    expect(printer.document.head.textContent).toContain('size: 80mm 52mm');
    expect(printer.print).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    const afterPrint = printer.addEventListener.mock.calls[0][1];
    afterPrint(); vi.advanceTimersByTime(1000);
    expect(frame.remove).toHaveBeenCalledOnce();
  });

  it('libera o frame e informa erro quando o navegador não consegue imprimir', async () => {
    const { frame, printer, append } = setupFrame();
    const printing = imprimirPdf(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    await vi.waitFor(() => expect(append).toHaveBeenCalledOnce());
    printer.print.mockImplementation(() => { throw new Error('Falha de impressão'); });
    await frame.onload?.();
    await expect(printing).rejects.toThrow('Não foi possível acionar a impressão');
    expect(frame.remove).toHaveBeenCalledOnce();
  });

  it('não mantém a tela presa quando o documento não carrega', async () => {
    const { frame, append } = setupFrame();
    const printing = imprimirPdf(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    await vi.waitFor(() => expect(append).toHaveBeenCalledOnce());
    const rejection = expect(printing).rejects.toThrow('demorou para carregar');
    vi.advanceTimersByTime(30_000);
    await rejection;
    expect(frame.remove).toHaveBeenCalledOnce();
    expect(frame.contentWindow.print).not.toHaveBeenCalled();
  });

  it('recusa resposta vazia ou que não seja PDF', async () => {
    await expect(imprimirPdf(new Blob([], { type: 'application/pdf' }))).rejects.toThrow('formato inválido');
    await expect(imprimirPdf(new Blob(['erro'], { type: 'text/html' }))).rejects.toThrow('formato inválido');
    expect(preparePdf).not.toHaveBeenCalled();
  });
});
