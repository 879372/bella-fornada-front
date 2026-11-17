import api from './api';

/** Mantém os filtros em todas as páginas e não confunde uma falha parcial com uma lista completa. */
export async function listarTodasPaginas<T>(url: string, params: Record<string, string | number> = {}): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  for (;;) {
    const { data } = await api.get<T[] | { results: T[]; next: string | null }>(url, { params: { ...params, page } });
    if (Array.isArray(data)) return data;
    items.push(...data.results);
    if (!data.next) return items;
    page += 1;
  }
}
