import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import api from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { useAuthStore } from './authStore';

vi.mock('../lib/api', () => ({ default: { post: vi.fn(), get: vi.fn() } }));
const storage = new Map<string, string>();
beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  storage.clear();
  queryClient.clear();
  useAuthStore.setState({ user: null, isAuthenticated: false });
});
afterEach(() => { queryClient.clear(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('trocar de conta elimina a sessão, venda e carrinho anteriores e usa o token novo', async () => {
  queryClient.setQueryData(['sessao-ativa'], { id: 'sessao-admin' });
  queryClient.setQueryData(['venda-aberta', 'sessao-admin', null], { id: 'venda-admin' });
  storage.set('pdv_venda', JSON.stringify({ id: 'venda-admin' }));
  storage.set('pdv_cart', '[{"nome":"Produto do admin"}]');
  storage.set('access_token', 'admin-access');
  vi.mocked(api.post).mockResolvedValue({ data: { access: 'caixa-access', refresh: 'caixa-refresh' } });
  vi.mocked(api.get).mockImplementation(async () => {
    expect(localStorage.getItem('access_token')).toBe('caixa-access');
    return { data: { id: 2, username: 'caixa', somente_pdv: true } };
  });

  await useAuthStore.getState().login('caixa', 'senha');

  expect(useAuthStore.getState().user?.id).toBe(2);
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  expect(localStorage.getItem('pdv_venda')).toBeNull();
  expect(localStorage.getItem('pdv_cart')).toBeNull();
  expect(localStorage.getItem('refresh_token')).toBe('caixa-refresh');
});

it('sair limpa os tokens e o cache da conta sem cancelar vendas no servidor', () => {
  queryClient.setQueryData(['sessao-ativa'], { id: 1 });
  storage.set('access_token', 'access');
  storage.set('refresh_token', 'refresh');
  storage.set('pdv_venda', '{"id":1}');
  useAuthStore.getState().logout();
  expect(localStorage.getItem('access_token')).toBeNull();
  expect(localStorage.getItem('refresh_token')).toBeNull();
  expect(localStorage.getItem('pdv_venda')).toBeNull();
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  expect(api.post).not.toHaveBeenCalled();
});
