import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Vendas from './Vendas';

const { get, post, list, setPage } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), list: vi.fn(), setPage: vi.fn() }));
const sale = { id: 7, status: 'FINALIZADA', total: '15.00', data: '2026-11-16T12:00:00Z', itens: [], pagamentos: [] };
vi.mock('../../lib/api', () => ({ default: { get, post } }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../../hooks/usePaginatedList', () => ({ usePaginatedList: list }));

describe('Histórico único e emissão nos detalhes', () => {
  beforeEach(() => {
    post.mockReset(); get.mockReset();
    list.mockReset(); setPage.mockReset();
    list.mockReturnValue({ items: [sale], isLoading: false, page: 1, setPage, totalPages: 1, isMobile: false });
    get.mockImplementation(async (url: string) => /^\/vendas\/\d+\/$/.test(url)
      ? { data: { ...sale, id: Number(url.split('/')[2]) } } : url.includes('vendas-elegiveis')
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

  it('abre a venda vinculada fora da página visível e leva às notas dessa venda', async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}</output>; }
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/vendas?venda=99']}><Vendas /><Location /></MemoryRouter></QueryClientProvider>);
    const modal = await screen.findByRole('dialog', { name: 'Venda #99' });
    expect(get).toHaveBeenCalledWith('/vendas/99/');
    await user.click(within(modal).getByRole('button', { name: 'Ver notas fiscais da venda' }));
    expect(screen.getByText('/fiscal?venda=99')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('aplica os mesmos filtros à lista e aos totalizadores e permite limpar tudo', async () => {
    get.mockImplementation(async (_url: string, config?: { params?: { status?: string } }) => ({
      data: { total: config?.params?.status ? { quantidade: 2, valor: '30.00' } : { quantidade: 51, valor: '765.00' } },
    }));
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><Vendas /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('51 registro(s)')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-11-16' } });
    await user.selectOptions(screen.getByLabelText('Status da venda'), 'CANCELADA');
    await user.type(screen.getByLabelText('Cliente ou número da venda'), 'Ana');
    const filters = { q: 'Ana', status: 'CANCELADA', data_inicio: '2026-11-01', data_fim: '2026-11-16' };
    await waitFor(() => expect(get).toHaveBeenCalledWith('/vendas/totalizadores/', { params: filters }));
    expect(await within(screen.getByRole('region', { name: 'Totalizadores' })).findByText('2 registro(s)')).toBeInTheDocument();
    const fetchPage = list.mock.lastCall![1];
    await fetchPage(2);
    expect(get).toHaveBeenCalledWith('/vendas/', { params: { ...filters, page: 2 } });
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(await screen.findByText('51 registro(s)')).toBeInTheDocument();
    expect(screen.getByLabelText('Cliente ou número da venda')).toHaveValue('');
    expect(screen.getByLabelText('Data inicial')).toHaveValue('');
    expect(screen.getByLabelText('Data final')).toHaveValue('');
    expect(screen.getByLabelText('Status da venda')).toHaveValue('');
    expect(setPage).toHaveBeenCalledWith(1);
  });
});
