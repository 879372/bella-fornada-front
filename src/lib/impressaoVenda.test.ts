import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CupomDados } from './cupom';
import { imprimirVenda } from './impressaoVenda';

const { get, imprimirCupom, imprimirPdf } = vi.hoisted(() => ({ get: vi.fn(), imprimirCupom: vi.fn(), imprimirPdf: vi.fn() }));
vi.mock('./api', () => ({ default: { get } }));
vi.mock('./impressao', () => ({ imprimirCupom, imprimirPdf }));

const dados: CupomDados = { numero: 47, data: new Date(), itens: [], total: 10, desconto: 0, pagamentos: [], troco: 0 };

describe('impressão automática da venda', () => {
  beforeEach(() => { get.mockReset(); imprimirCupom.mockReset(); imprimirPdf.mockReset(); });

  it('imprime o PDF fiscal disponível sem imprimir um DAV junto', async () => {
    const pdf = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    get.mockResolvedValueOnce({ data: { results: [{ id: 'nota-47', status: 'AUTORIZADA', pode_baixar_pdf: true }] } });
    get.mockResolvedValueOnce({ data: pdf });
    await imprimirVenda(dados);
    expect(get).toHaveBeenNthCalledWith(1, '/fiscal/documentos/', { params: { venda: 47, status: 'AUTORIZADA', page: 1 } });
    expect(get).toHaveBeenNthCalledWith(2, '/fiscal/documentos/nota-47/pdf/', { responseType: 'blob' });
    expect(imprimirPdf).toHaveBeenCalledExactlyOnceWith(pdf);
    expect(imprimirCupom).not.toHaveBeenCalled();
  });

  it.each([
    { documents: [] },
    { documents: [{ id: 'sem-pdf', status: 'AUTORIZADA', pode_baixar_pdf: false }] },
    { documents: [{ id: 'cancelada', status: 'CANCELADA', pode_baixar_pdf: true }] },
  ])('imprime o comprovante não fiscal quando não há documento fiscal imprimível (%j)', async ({ documents }) => {
    get.mockResolvedValue({ data: { results: documents } });
    await imprimirVenda(dados);
    expect(imprimirCupom).toHaveBeenCalledExactlyOnceWith(dados);
    expect(imprimirPdf).not.toHaveBeenCalled();
  });

  it('procura em todas as páginas antes de usar o comprovante não fiscal', async () => {
    const pdf = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    get.mockResolvedValueOnce({ data: { results: [], next: '/api/fiscal/documentos/?page=2' } });
    get.mockResolvedValueOnce({ data: { results: [{ id: 'nota-antiga', status: 'AUTORIZADA', pode_baixar_pdf: true }] } });
    get.mockResolvedValueOnce({ data: pdf });
    await imprimirVenda(dados);
    expect(get).toHaveBeenNthCalledWith(2, '/fiscal/documentos/', { params: { venda: 47, status: 'AUTORIZADA', page: 2 } });
    expect(imprimirPdf).toHaveBeenCalledExactlyOnceWith(pdf);
    expect(imprimirCupom).not.toHaveBeenCalled();
  });

  it('não trata erro de consulta ou de download como ausência de nota fiscal', async () => {
    get.mockRejectedValueOnce(new Error('Falha na consulta'));
    await expect(imprimirVenda(dados)).rejects.toThrow('Falha na consulta');
    get.mockResolvedValueOnce({ data: { results: [{ id: 'nota', status: 'AUTORIZADA', pode_baixar_pdf: true }] } });
    get.mockRejectedValueOnce(new Error('Falha no download'));
    await expect(imprimirVenda(dados)).rejects.toThrow('Falha no download');
    expect(imprimirCupom).not.toHaveBeenCalled();
    expect(imprimirPdf).not.toHaveBeenCalled();
  });
});
