import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import api from '../../lib/api';
import * as pasta from '../../lib/pastaBalanca';
import Balancas from './Balancas';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/pastaBalanca', () => ({
  PASTA_BALANCA_SUGERIDA: 'C:\\Balanca', baixarArquivo: vi.fn(), gravarNaPasta: vi.fn(),
  nomePastaSalva: vi.fn(), obterPastaBalanca: vi.fn(), suportaGravarNaPasta: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(pasta.suportaGravarNaPasta).mockReturnValue(true);
  vi.mocked(pasta.nomePastaSalva).mockResolvedValue(null);
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/balancas/configuracao/') return { data: { departamento: 1, validade_padrao_dias: 1 } };
    return { data: new Blob([url]) };
  });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('obtém permissão da pasta antes da rede e grava os dois arquivos', async () => {
  const handle = { name: 'Balanca', getFileHandle: vi.fn() };
  vi.mocked(pasta.obterPastaBalanca).mockImplementation(async () => {
    expect(api.get).not.toHaveBeenCalledWith('/balancas/exportar/', expect.anything());
    return handle;
  });
  render(<Balancas />);
  fireEvent.click(await screen.findByRole('button', { name: 'Gerar carga MGV' }));
  await waitFor(() => expect(pasta.gravarNaPasta).toHaveBeenCalledWith(handle, {
    'ITENSMGV.TXT': expect.any(Blob), 'DEPTO.TXT': expect.any(Blob),
  }));
  expect(pasta.baixarArquivo).not.toHaveBeenCalled();
});

it('cancelar a pasta não busca nem grava os arquivos', async () => {
  vi.mocked(pasta.obterPastaBalanca).mockRejectedValue(new DOMException('Cancelado', 'AbortError'));
  render(<Balancas />);
  fireEvent.click(await screen.findByRole('button', { name: 'Gerar carga MGV' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Gerar carga MGV' })).toBeEnabled());
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(pasta.gravarNaPasta).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it('baixa os dois arquivos quando não há suporte a pasta', async () => {
  vi.mocked(pasta.suportaGravarNaPasta).mockReturnValue(false);
  render(<Balancas />);
  fireEvent.click(await screen.findByRole('button', { name: 'Gerar carga MGV' }));
  await waitFor(() => expect(pasta.baixarArquivo).toHaveBeenCalledTimes(2));
  expect(pasta.baixarArquivo).toHaveBeenCalledWith('ITENSMGV.TXT', expect.any(Blob));
  expect(pasta.baixarArquivo).toHaveBeenCalledWith('DEPTO.TXT', expect.any(Blob));
  expect(pasta.obterPastaBalanca).not.toHaveBeenCalled();
});

it('não grava uma carga parcial se a geração de um arquivo falhar', async () => {
  vi.mocked(pasta.obterPastaBalanca).mockResolvedValue({ name: 'Balanca', getFileHandle: vi.fn() });
  render(<Balancas />);
  const botao = await screen.findByRole('button', { name: 'Gerar carga MGV' });
  vi.mocked(api.get).mockRejectedValue(new Error('Falha de rede'));
  fireEvent.click(botao);
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(pasta.gravarNaPasta).not.toHaveBeenCalled();
});
