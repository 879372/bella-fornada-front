import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imprimirPdf } from './impressao';

const createUrl = vi.fn(() => 'blob:pdf-fiscal');
const revokeUrl = vi.fn();

function prepareFrame() {
  const frame = document.querySelector('iframe')!;
  const printer = { focus: vi.fn(), print: vi.fn(), addEventListener: vi.fn() };
  Object.defineProperty(frame, 'contentWindow', { value: printer, configurable: true });
  return { frame, printer };
}

describe('impressão do PDF fiscal', () => {
  beforeEach(() => {
    vi.useFakeTimers(); createUrl.mockClear(); revokeUrl.mockClear();
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = createUrl;
      static revokeObjectURL = revokeUrl;
    });
  });
  afterEach(() => { document.querySelectorAll('iframe').forEach(frame => frame.remove()); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('aguarda o PDF carregar e aciona print sem abrir outra aba', async () => {
    const open = vi.spyOn(window, 'open');
    const printing = imprimirPdf(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    const { frame, printer } = prepareFrame();
    expect(printer.print).not.toHaveBeenCalled();
    frame.dispatchEvent(new Event('load'));
    await printing;
    expect(printer.print).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    const afterPrint = printer.addEventListener.mock.calls[0][1];
    afterPrint(); vi.advanceTimersByTime(1000);
    expect(frame.isConnected).toBe(false);
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:pdf-fiscal');
    open.mockRestore();
  });

  it('libera o PDF e informa erro quando o navegador não consegue imprimir', async () => {
    const printing = imprimirPdf(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    const { frame, printer } = prepareFrame();
    printer.print.mockImplementation(() => { throw new Error('Falha de impressão'); });
    frame.dispatchEvent(new Event('load'));
    await expect(printing).rejects.toThrow('Não foi possível acionar a impressão');
    expect(frame.isConnected).toBe(false);
    expect(revokeUrl).toHaveBeenCalledOnce();
  });

  it('não mantém a tela presa quando o PDF não carrega', async () => {
    const printing = imprimirPdf(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    const rejection = expect(printing).rejects.toThrow('demorou para carregar');
    vi.advanceTimersByTime(30_000);
    await rejection;
    expect(document.querySelector('iframe')).toBeNull();
    expect(revokeUrl).toHaveBeenCalledOnce();
  });

  it('recusa resposta vazia ou que não seja PDF', async () => {
    await expect(imprimirPdf(new Blob([], { type: 'application/pdf' }))).rejects.toThrow('formato inválido');
    await expect(imprimirPdf(new Blob(['erro'], { type: 'text/html' }))).rejects.toThrow('formato inválido');
    expect(createUrl).not.toHaveBeenCalled();
  });
});
