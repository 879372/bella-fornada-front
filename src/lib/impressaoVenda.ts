import api from './api';
import type { CupomDados } from './cupom';
import { imprimirCupom, imprimirPdf } from './impressao';

type DocumentoImprimivel = { id: string; status: string; pode_baixar_pdf: boolean };
type PaginaDocumentos = { results: DocumentoImprimivel[]; next?: string | null };

/** Usa o documento fiscal disponível; o DAV é reservado às vendas sem PDF fiscal. */
export async function imprimirVenda(dados: CupomDados) {
  let page = 1;
  while (true) {
    const { data } = await api.get<PaginaDocumentos | DocumentoImprimivel[]>('/fiscal/documentos/', {
      params: { venda: dados.numero, status: 'AUTORIZADA', page },
    });
    const documents = Array.isArray(data) ? data : data.results;
    const fiscal = documents.find(document => document.status === 'AUTORIZADA' && document.pode_baixar_pdf);
    if (fiscal) {
      const response = await api.get<Blob>(`/fiscal/documentos/${fiscal.id}/pdf/`, { responseType: 'blob' });
      await imprimirPdf(response.data);
      return;
    }
    if (Array.isArray(data) || !data.next) break;
    page += 1;
  }
  await imprimirCupom(dados);
}
