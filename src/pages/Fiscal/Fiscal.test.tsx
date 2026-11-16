import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fiscal from './Fiscal';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../lib/api', () => ({ default: { get, post } }));
vi.mock('../../store/authStore', () => ({ useAuthStore: () => ({ papel: 'ADMIN' }) }));

const document = {
  id: 'nota-1', venda_numero: 7, tipo: 'NFCE', tipo_display: 'NFC-e', status: 'REJEITADA',
  status_display: 'Rejeitada', ambiente: 'producao', numero: '123', serie: '1',
  pode_inutilizar: true, pode_cancelar: false, created_at: '2026-11-16T12:00:00Z',
};

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><Fiscal /></QueryClientProvider>);
}

describe('Confirmações fiscais', () => {
  beforeEach(() => {
    get.mockReset(); post.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === '/fiscal/configuracao/') return { data: { ambiente: 'producao', serie_nfce: '1' } };
      if (url === '/fiscal/documentos/') return { data: { count: 1, results: [document] } };
      if (url === '/fiscal/documentos/totalizadores/') return { data: { ambiente: 'producao', transmitidas: { quantidade: 2, valor: '30.00' }, pendentes: { quantidade: 1, valor: '15.00' } } };
      if (url === '/fiscal/monitor/') return { data: { certificado: { mensagem: 'Válido' }, resumo: {}, alertas: [] } };
      return { data: [] };
    });
    post.mockResolvedValue({ data: { status: 'INUTILIZADA', numero_inicial: 123, numero_final: 123 } });
  });
  afterEach(cleanup);

  it('abre a confirmação individual sem transmitir; cancelar preserva a nota', async () => {
    const user = userEvent.setup(); mount();
    await user.click(await screen.findByRole('button', { name: 'Inutilizar' }));
    const modal = screen.getByRole('dialog', { name: 'Confirmar inutilização' });
    expect(modal).toHaveTextContent('números 123 até 123');
    expect(modal).toHaveTextContent('PRODUÇÃO');
    expect(post).not.toHaveBeenCalled();
    await user.click(within(modal).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('exige justificativa válida e transmite apenas a numeração confirmada', async () => {
    const user = userEvent.setup(); mount();
    await user.click(await screen.findByRole('button', { name: 'Inutilizar' }));
    const modal = screen.getByRole('dialog', { name: 'Confirmar inutilização' });
    const reason = within(modal).getByLabelText(/Justificativa/);
    await user.clear(reason);
    expect(within(modal).getByRole('button', { name: 'Confirmar inutilização' })).toBeDisabled();
    await user.type(reason, 'Numeração rejeitada não utilizada.');
    await user.click(within(modal).getByRole('button', { name: 'Confirmar inutilização' }));
    expect(post).toHaveBeenCalledExactlyOnceWith('/fiscal/inutilizacoes/', {
      tipo: 'NFCE', serie: '1', ano: 2026, numero_inicial: 123, numero_final: 123,
      justificativa: 'Numeração rejeitada não utilizada.',
    });
  });

  it('reenvio também aguarda confirmação no modal', async () => {
    const user = userEvent.setup(); mount();
    await user.click(await screen.findByRole('button', { name: 'Resolver e reenviar' }));
    expect(post).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reenviar documento' }));
    expect(post).toHaveBeenCalledExactlyOnceWith('/fiscal/documentos/emitir/', { venda: 7, tipo: 'NFCE', canal: 'PDV' });
  });
});
