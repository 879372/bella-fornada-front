import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EnviarXmlContadorModal from './EnviarXmlContadorModal';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../../lib/api', () => ({ default: { post } }));
const config = { email_contador: 'contador@example.com', email_remetente: 'fiscal@kaibez.com.br', ambiente: 'producao', resend_configurado: true };
function mount(ready = true) {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><EnviarXmlContadorModal config={{ ...config, resend_configurado: ready }} onClose={onClose} /></MemoryRouter></QueryClientProvider>);
  return onClose;
}

describe('Envio dos XMLs ao contador', () => {
  beforeEach(() => { post.mockReset(); });
  afterEach(cleanup);

  it('preenche o contador e envia o destinatário editado e o período escolhido somente após clicar', async () => {
    post.mockResolvedValue({ data: { email: 'alternativo@example.com', quantidade: 5 } });
    const user = userEvent.setup(); const onClose = mount();
    expect(screen.getByLabelText('E-mail do contador')).toHaveValue('contador@example.com');
    expect(post).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('E-mail do contador'));
    await user.type(screen.getByLabelText('E-mail do contador'), 'alternativo@example.com');
    fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-11-30' } });
    await user.click(screen.getByRole('button', { name: 'Enviar ZIP por e-mail' }));
    expect(post).toHaveBeenCalledExactlyOnceWith('/fiscal/documentos/enviar-xml-contador/', {
      email: 'alternativo@example.com', data_inicio: '2026-11-01', data_fim: '2026-11-30',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('bloqueia período inválido e indisponibilidade do Resend', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-11-30' } });
    expect(screen.getByRole('button', { name: 'Enviar ZIP por e-mail' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('data final');
    expect(post).not.toHaveBeenCalled();
    cleanup(); mount(false);
    expect(screen.getByRole('button', { name: 'Enviar ZIP por e-mail' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Resend ainda não está configurado');
  });

  it('mantém o modal aberto com o erro retornado pelo servidor', async () => {
    post.mockRejectedValue(Object.assign(new AxiosError('Erro'), { response: { data: { detail: 'Nenhuma nota encontrada no período.' } } }));
    const user = userEvent.setup(); const onClose = mount();
    await user.click(screen.getByRole('button', { name: 'Enviar ZIP por e-mail' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nenhuma nota encontrada');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('E-mail do contador')).toHaveValue('contador@example.com');
  });
});
