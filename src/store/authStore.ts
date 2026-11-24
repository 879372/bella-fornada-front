import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import api from '../lib/api';
import { limparDadosDaConta } from '../lib/queryClient';

interface User {
  id: number;
  username: string;
  first_name?: string;
  last_name?: string;
  papel?: 'ADMIN' | 'GERENTE' | 'CAIXA' | 'PRODUCAO' | 'ENTREGADOR';
  papel_label?: string;
  /** Caixa: entra direto no PDV e não acessa o painel administrativo. */
  somente_pdv?: boolean;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => void;
  setUser: (user: User | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,

      setUser: (user) => set({ user, isAuthenticated: !!user }),

      login: async (username, password) => {
        // New backend path: api/auth/login/
        const { data } = await api.post('/auth/login/', { username, password });

        localStorage.setItem('access_token', data.access);
        localStorage.setItem('refresh_token', data.refresh);

        const { data: user } = await api.get<User>('/auth/me/');
        limparDadosDaConta();
        set({ user, isAuthenticated: true });
        return user;
      },

      logout: () => {
        limparDadosDaConta();
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        set({ user: null, isAuthenticated: false });
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
