import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { listarTodasPaginas } from './listarTodasPaginas';
vi.mock('./api', () => ({ default: { get: vi.fn() } }));
beforeEach(() => { vi.mocked(api.get).mockReset(); });
describe('listarTodasPaginas', () => {
  it('carrega todas as páginas preservando os filtros', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { results: [{ id: 1 }], next: 'next' } }).mockResolvedValueOnce({ data: { results: [{ id: 2 }], next: null } });
    expect(await listarTodasPaginas('/vendas/', { sessao: 7 })).toEqual([{ id: 1 }, { id: 2 }]);
    expect(api.get).toHaveBeenNthCalledWith(2, '/vendas/', { params: { sessao: 7, page: 2 } });
  });
  it('não apresenta uma lista parcial como resultado completo se uma página falha', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { results: [{ id: 1 }], next: 'next' } }).mockRejectedValueOnce(new Error('Falha'));
    await expect(listarTodasPaginas('/vendas/')).rejects.toThrow('Falha');
  });
});
