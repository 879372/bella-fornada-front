import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Vendas from './Vendas';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../lib/api', () => ({ default: { get, post } }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../hooks/usePaginatedList', () => ({ usePaginatedList: () => ({
  items: [{ id: 7, status: 'FINALIZADA', total: '15.00', data: '2026-11-16T12:00:00Z', itens: [], pagamentos: [] }],
  isLoading: false, page: 1, setPage: vi.fn(), totalPages: 1, isMobile: false,
}) }));

describe('Histórico único e emissão nos detalhes', () => {
  beforeEach(() => {
    post.mockReset(); get.mockReset();
    get.mockImplementation(async (url: string) => url.includes('vendas-elegiveis')
      ? { data: { count: 1, results: [{ id: 7 }] } }
      : { data: { total: { quantidade: 51, valor: '765.00' } } });
    post.mockResolvedValue({ data: { status: 'AUTORIZADA' } });
  });
  afterEach(cleanup);

  it('mostra total do servidor e emite somente pelos detalhes após confirmar', async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><Vendas /></MemoryRouter></QueryClientProvider>);
    expect(screen.queryByText('Vendas prontas para emitir')).not.toBeInTheDocument();
    expect(await screen.findByText('51 registro(s)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Emitir NFC-e' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Detalhes' }));
    await user.click(await screen.findByRole('button', { name: 'Emitir NFC-e' }));
    expect(post).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('dialog', { name: 'Confirmar emissão de nota fiscal' });
    await user.click(within(confirmation).getByRole('button', { name: 'Emitir nota' }));
    expect(post).toHaveBeenCalledExactlyOnceWith('/fiscal/documentos/emitir/', { venda: 7, tipo: 'NFCE', canal: 'PDV' });
  });
});
