import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PDV from './PDV';
import api from '../../lib/api';
vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));
const venda = { id: '9', sessao: '1', status: 'EM_ABERTO', total: '10', itens: [{ id: '2', produto: { id: '3', nome: 'Pão teste' }, quantidade: '1', preco_unitario: '10', subtotal: '10' }] };
let cancelada = false;
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); }, clear: () => { storage.clear(); } });
  cancelada = false;
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.get).mockImplementation(async url => {
    if (url === '/sessoes-caixa/ativa/') return { data: { id: '1', fundo_inicial: '100', saldo_final_calculado: '100', operador_nome: 'Ana', status: 'ABERTA' } };
    if (url === '/vendas/') return { data: { results: cancelada ? [] : [venda] } };
    return { data: [] };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const montar = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/pdv']}><PDV /></MemoryRouter></QueryClientProvider>);
it('confirma cancelamento no servidor antes de limpar o carrinho', async () => {
  let concluir!: () => void;
  vi.mocked(api.post).mockImplementation(() => new Promise(resolve => { concluir = () => { cancelada = true; resolve({ data: {} }); }; }));
  montar();
  await screen.findByText('Pão teste');
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar venda atual' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sim, Cancelar' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/vendas/9/cancelar/', { motivo: 'Cancelamento solicitado no PDV.' }));
  expect(screen.getByText('Pão teste')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancelando...' })).toBeDisabled();
  concluir();
  await waitFor(() => expect(screen.queryByText('Pão teste')).not.toBeInTheDocument());
  await waitFor(() => expect(localStorage.getItem('pdv_venda')).toBeNull());
});
it('mantém a venda e o carrinho quando o servidor recusa o cancelamento', async () => {
  vi.mocked(api.post).mockRejectedValue({ response: { data: { erro: 'Falha de cancelamento' } } });
  montar();
  await screen.findByText('Pão teste');
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar venda atual' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sim, Cancelar' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sim, Cancelar' })).toBeEnabled());
  expect(screen.getByText('Pão teste')).toBeInTheDocument();
});
