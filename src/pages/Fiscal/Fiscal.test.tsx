import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
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

function mount(path = '/fiscal') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Fiscal /></MemoryRouter></QueryClientProvider>);
}

describe('Confirmações fiscais', () => {
  beforeEach(() => {
    get.mockReset(); post.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === '/fiscal/configuracao/') return { data: { ambiente: 'producao', serie_nfce: '1', email_contador: 'contador@example.com', email_remetente: 'fiscal@kaibez.com.br', resend_configurado: true } };
      if (url === '/fiscal/documentos/') return { data: { count: 1, results: [document] } };
      if (url === '/fiscal/documentos/totalizadores/') return { data: { ambiente: 'producao', transmitidas: { quantidade: 2, valor: '30.00' }, pendentes: { quantidade: 1, valor: '15.00' } } };
      if (url === '/fiscal/monitor/') return { data: { certificado: { mensagem: 'Válido' }, resumo: {}, alertas: [
        ...['RESULTADO_INDEFINIDO', 'DOCUMENTO_REJEITADO', 'ERRO_FISCAL', 'VENDAS_SEM_DOCUMENTO', 'CONTINGENCIA_NAO_SUPORTADA'].map(codigo => ({ codigo, titulo: `Aviso removido ${codigo}`, descricao: 'Descrição removida', nivel: 'AVISO', quantidade: 1 })),
        { codigo: 'CERTIFICADO_INVALIDO', titulo: 'Certificado A1 indisponível', descricao: 'Confira o certificado.', nivel: 'ERRO', quantidade: 1 },
      ] } };
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

  it('filtra por status no servidor, preserva a venda e volta à primeira página', async () => {
    const user = userEvent.setup(); mount('/fiscal?venda=7&pagina=2');
    expect(await screen.findByRole('link', { name: 'Ver venda #7' })).toHaveAttribute('href', '/vendas?venda=7');
    expect(get).toHaveBeenCalledWith('/fiscal/documentos/', { params: { page: 2, venda: '7', status: undefined, q: undefined } });
    await user.selectOptions(screen.getByLabelText('Status do documento'), 'REJEITADA');
    expect(get).toHaveBeenCalledWith('/fiscal/documentos/', { params: { page: 1, venda: '7', status: 'REJEITADA', q: undefined } });
    await user.selectOptions(screen.getByLabelText('Status do documento'), '');
    expect(get).toHaveBeenCalledWith('/fiscal/documentos/', { params: { page: 1, venda: '7', status: undefined, q: undefined } });
  });

  it('remove os cinco avisos solicitados e preserva informações do certificado', async () => {
    mount();
    expect(await screen.findByText('Certificado A1 indisponível')).toBeInTheDocument();
    expect(screen.queryByText(/Aviso removido/)).not.toBeInTheDocument();
    expect(screen.queryByText('Descrição removida')).not.toBeInTheDocument();
  });
  it('busca pelo número ou pela chave preservando status e venda, na primeira página', async () => {
    mount('/fiscal?venda=7&status=REJEITADA&pagina=2');
    const search = screen.getByLabelText('Buscar nota fiscal');
    fireEvent.change(search, { target: { value: '14056' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/fiscal/documentos/', { params: { page: 1, venda: '7', status: 'REJEITADA', q: '14056' } }));
    const key = '9'.repeat(44);
    fireEvent.change(search, { target: { value: key } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/fiscal/documentos/', { params: { page: 1, venda: '7', status: 'REJEITADA', q: key } }));
    fireEvent.change(search, { target: { value: '' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/fiscal/documentos/', { params: { page: 1, venda: '7', status: 'REJEITADA', q: undefined } }));
  });

  it('abre a opção de envio ao contador com o e-mail configurado, sem envio automático', async () => {
    const user = userEvent.setup(); mount();
    const button = await screen.findByRole('button', { name: 'Enviar XMLs ao contador' });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(screen.getByRole('dialog', { name: 'Enviar XMLs ao contador' })).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail do contador')).toHaveValue('contador@example.com');
    expect(post).not.toHaveBeenCalled();
  });

});
