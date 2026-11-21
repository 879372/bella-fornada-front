import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import Login from './Login';

const login = vi.fn();
vi.mock('../../store/authStore', () => ({ useAuthStore: () => ({ login }) }));

afterEach(() => { cleanup(); login.mockReset(); });

const entrar = (rota: string) => {
  render(<MemoryRouter initialEntries={[rota]}><Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/caixa" element={<Login modo="pdv" />} />
    <Route path="/pdv" element={<p>tela do PDV</p>} />
    <Route path="/dashboard" element={<p>painel</p>} />
  </Routes></MemoryRouter>);
  fireEvent.change(screen.getByLabelText(/usuário/i), { target: { value: 'erica' } });
  fireEvent.change(screen.getByLabelText(/senha/i), { target: { value: 'segredo' } });
  fireEvent.click(screen.getByRole('button', { name: /entrar/i }));
};

it('leva o caixa direto ao PDV mesmo pelo login do painel', async () => {
  login.mockResolvedValue({ id: 1, username: 'erica', somente_pdv: true });
  entrar('/login');
  expect(await screen.findByText('tela do PDV')).toBeInTheDocument();
});

it('mantém gerente no painel pelo login normal', async () => {
  login.mockResolvedValue({ id: 2, username: 'gerente', somente_pdv: false });
  entrar('/login');
  expect(await screen.findByText('painel')).toBeInTheDocument();
});

it('login do caixa sempre abre o PDV', async () => {
  login.mockResolvedValue({ id: 2, username: 'gerente', somente_pdv: false });
  entrar('/caixa');
  await waitFor(() => expect(screen.getByText('tela do PDV')).toBeInTheDocument());
});

it('associa os labels e exibe erro de autenticação acessível', async () => {
  const user = userEvent.setup();
  login.mockRejectedValueOnce(new Error('unauthorized'));

  render(<MemoryRouter><Login /></MemoryRouter>);

  const username = screen.getByLabelText('Usuário');
  const password = screen.getByLabelText('Senha');

  await user.type(username, 'operador');
  await user.type(password, 'senha-incorreta');
  await user.click(screen.getByRole('button', { name: 'Entrar no Sistema' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível entrar');
  expect(username).toHaveAttribute('aria-invalid', 'true');
  expect(password).toHaveAttribute('aria-invalid', 'true');
});
