import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import ConfiguracaoFiscal from './ConfiguracaoFiscal';

const { get, patch } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('../../lib/api', () => ({ default: { get, patch } }));
afterEach(cleanup);

it('salva o e-mail padrão e o remetente, sem solicitar nem transmitir token pelo navegador', async () => {
  get.mockResolvedValue({ data: { email_contador: 'contador@example.com', email_remetente: 'fiscal@kaibez.com.br', resend_configurado: true } });
  patch.mockResolvedValue({ data: { email_contador: 'novo@example.com', email_remetente: 'fiscal@kaibez.com.br', resend_configurado: true } });
  const user = userEvent.setup(); render(<ConfiguracaoFiscal />);
  const email = await screen.findByLabelText('E-mail do contador');
  await user.clear(email); await user.type(email, 'novo@example.com');
  await user.click(screen.getByRole('button', { name: 'Salvar configuração fiscal' }));
  const body = patch.mock.calls[0][1] as FormData;
  expect(body.get('email_contador')).toBe('novo@example.com');
  expect(body.get('email_remetente')).toBe('fiscal@kaibez.com.br');
  expect(body.has('RESEND_API_KEY')).toBe(false);
  expect(body.has('resend_configurado')).toBe(false);
});
