import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Fechamentos from './Fechamentos';
import api from '../../lib/api';
import { listarTodasPaginas } from '../../lib/listarTodasPaginas';
vi.mock('../../lib/api', () => ({ default: { post: vi.fn() } }));
vi.mock('../../store/authStore', () => ({ useAuthStore: (selector: (state: { user: { id: number } }) => unknown) => selector({ user: { id: 2 } }) }));
vi.mock('../../lib/listarTodasPaginas', () => ({ listarTodasPaginas: vi.fn() }));
afterEach(() => { cleanup(); });
const resumo = { quantidade_vendas: 1, quantidade_total: 2, quantidade_abertas: 0, quantidade_canceladas: 1, quantidade_orcamentos: 0, total_bruto: '100', descontos: '10', total_liquido: '90', ticket_medio: '90', total_sangrias: '10', total_suprimentos: '0', saldo_esperado: '120', por_forma: { DINHEIRO: { valor: '30', quantidade: 1 }, PIX: { valor: '60', quantidade: 1 } }, operacoes: [] };
beforeEach(() => {
  vi.mocked(listarTodasPaginas).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.post).mockResolvedValue({ data: {} });
  vi.mocked(listarTodasPaginas).mockImplementation(async url => url === '/vendas/' ? [
    { id: 9, data: '2026-11-17T10:00:00Z', cliente_nome: 'Maria', status: 'FINALIZADA', total: '100', desconto: '10', pagamentos: [{ forma: 'PIX', valor: '60' }] },
    { id: 10, data: '2026-11-17T11:00:00Z', cliente_nome: null, status: 'CANCELADA', total: '50', desconto: '0', pagamentos: [] },
  ] : [
    { id: 1, operador: 1, operador_nome: 'Ana', status: 'FECHADA', aberta_em: '2026-11-17T08:00:00Z', fechada_em: '2026-11-17T18:00:00Z', fundo_inicial: '100', valor_contado: '115', diferenca_caixa: '-5', observacoes: '', resumo },
    { id: 2, operador: 2, operador_nome: 'Pedro', status: 'ABERTA', aberta_em: '2026-11-17T08:00:00Z', fechada_em: null, fundo_inicial: '100', valor_contado: null, diferenca_caixa: null, observacoes: '', resumo: { ...resumo, quantidade_abertas: 1 } },
  ] as never);
});
const montar = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><Fechamentos /></MemoryRouter></QueryClientProvider>);
it('aplica busca aos caixas e aos totalizadores', async () => {
  montar();
  await screen.findByText('Ana');
  fireEvent.change(screen.getByLabelText('Buscar caixa ou operador'), { target: { value: 'Ana' } });
  expect(screen.queryByText('Pedro')).not.toBeInTheDocument();
  const totais = screen.getByRole('region', { name: 'Totalizadores dos caixas filtrados' });
  expect(within(totais).getByText('1 vendas · valor líquido')).toBeInTheDocument();
  expect(within(totais).getByText(/90,00/)).toBeInTheDocument();
});
it('abre todas as vendas, filtra status e permite acessar o detalhe da venda', async () => {
  montar();
  fireEvent.click((await screen.findAllByRole('button', { name: 'Ver vendas e detalhes' }))[0]);
  expect(await screen.findByText('Maria')).toBeInTheDocument();
  expect(listarTodasPaginas).toHaveBeenCalledWith('/vendas/', { sessao: 1 });
  expect(screen.getByText('2 de 2 vendas da sessão')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Status da venda'), { target: { value: 'FINALIZADA' } });
  expect(screen.getByText('1 de 2 vendas da sessão')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Ver venda' })).toHaveAttribute('href', '/vendas?venda=9');
});

it('fecha o próprio caixa somente após conferir e confirmar o valor contado', async () => {
  montar();
  fireEvent.click((await screen.findAllByRole('button', { name: 'Ver vendas e detalhes' }))[1]);
  fireEvent.click(screen.getByRole('button', { name: 'Fechar este caixa' }));
  const modal = screen.getByRole('dialog');
  expect(within(modal).getByText(/todas as vendas em aberto desta sessão serão canceladas automaticamente/)).toBeInTheDocument();
  expect(within(modal).getByRole('button', { name: 'Confirmar fechamento' })).toBeDisabled();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.change(within(modal).getByLabelText('Valor contado em dinheiro (R$)'), { target: { value: '115.00' } });
  fireEvent.click(within(modal).getByRole('button', { name: 'Confirmar fechamento' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/sessoes-caixa/2/fechar/', { valor_contado: '115.00' }));
});
