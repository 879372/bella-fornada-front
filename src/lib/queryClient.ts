import { keepPreviousData, QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5,
      placeholderData: keepPreviousData,
    },
  },
});

export function limparDadosDaConta() {
  queryClient.clear();
  localStorage.removeItem('pdv_cart');
  localStorage.removeItem('pdv_venda');
}
