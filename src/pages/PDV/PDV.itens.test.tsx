import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import PDV from './PDV';
import api from '../../lib/api';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

it('mantém leituras repetidas em linhas distintas antes e depois de recarregar a venda', async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  });
  const produto = { id: '3', nome: 'Pão teste', preco_venda: '5.00', unidade_medida: 'UN' };
  const item = { id: '10', produto, quantidade: '1.000', preco_unitario: '5.00', subtotal: '5.00' };
  const venda = { id: '9', sessao: '1', status: 'EM_ABERTO', total: '5.00', itens: [item] };
  let recarregar = false;
  let concluirRecarga!: () => void;
  vi.mocked(api.get).mockImplementation(async url => {
    if (url === '/sessoes-caixa/ativa/') return { data: { id: '1', fundo_inicial: '100', saldo_final_calculado: '100', status: 'ABERTA' } };
    if (url === '/vendas/') {
      // Mantém o refetch pendente para validar também o carrinho local.
      if (recarregar) return new Promise(resolve => {
        concluirRecarga = () => resolve({ data: { results: [{ ...venda, total: '10.00', itens: [item, { ...item, id: '11' }] }] } });
      });
      return { data: { results: [venda] } };
    }
    if (url === '/produtos/por-codigo/') return { data: [produto] };
    return { data: [] };
  });
  vi.mocked(api.post).mockImplementation(async () => {
    recarregar = true;
    return { data: { ...item, id: '11', produto: produto.id } };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><PDV /></MemoryRouter></QueryClientProvider>);
  await screen.findByText('Pão teste');
  const busca = screen.getByPlaceholderText('Buscar produto... (F3)');
  fireEvent.change(busca, { target: { value: '789123' } });
  fireEvent.keyDown(busca, { key: 'Enter' });
  await waitFor(() => expect(screen.getAllByText('Pão teste')).toHaveLength(2));
  expect(screen.getAllByText('1 x R$ 5.00')).toHaveLength(2);
  expect(api.post).toHaveBeenCalledWith('/venda-itens/', expect.objectContaining({ venda: '9', produto: '3', quantidade: 1 }));

  await waitFor(() => expect(concluirRecarga).toBeTypeOf('function'));
  concluirRecarga();
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await waitFor(() => expect(screen.getAllByText('1 x R$ 5.00')).toHaveLength(2));
});
