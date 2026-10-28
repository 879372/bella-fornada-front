import axios, { AxiosError, type AxiosRequestConfig } from 'axios';

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api').replace(/\/$/, '');

/**
 * Cliente separado para o cardapio publico. Ele deliberadamente nao herda o
 * token do PDV: um token antigo nao pode impedir o acesso a rotas AllowAny.
 */
const publicApi = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 20_000,
});

type ApiErrorBody = {
  detail?: unknown;
  erro?: unknown;
  error?: unknown;
  message?: unknown;
  non_field_errors?: unknown;
};

export function publicApiError(error: unknown, fallback = 'Nao foi possivel concluir a operacao.'): string {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.message : fallback;
  const body = (error as AxiosError<ApiErrorBody>).response?.data;
  const candidate = body?.detail ?? body?.erro ?? body?.error ?? body?.message;
  if (typeof candidate === 'string' && candidate.trim()) return candidate;
  if (Array.isArray(body?.non_field_errors) && body.non_field_errors.length) {
    return body.non_field_errors.map(String).join(' ');
  }
  return error.message || fallback;
}

/** Tenta a rota compativel apenas quando a rota principal ainda nao existe. */
export async function publicRequestWithFallback<T>(
  primary: AxiosRequestConfig,
  fallback?: AxiosRequestConfig,
): Promise<T> {
  try {
    const response = await publicApi.request<T>(primary);
    return response.data;
  } catch (error) {
    if (!fallback || !axios.isAxiosError(error) || error.response?.status !== 404) throw error;
    const response = await publicApi.request<T>(fallback);
    return response.data;
  }
}

export default publicApi;
