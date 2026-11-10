import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { Download, FileCheck2, FileText, RefreshCw, ReceiptText, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';

type VendaElegivel = { id: number; data: string; cliente_nome?: string; total_liquido: string; itens_count: number };
type Documento = { id: string; venda_numero: number; tipo_display: string; status: string; status_display: string; ambiente: string; mensagem_sefaz?: string; numero?: string; serie?: string; chave_acesso?: string; pode_baixar_xml: boolean; pode_baixar_pdf: boolean };
type ApiError = { detail?: string };
const money = (value: string | number) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const errorMessage = (error: unknown, fallback: string) => error instanceof AxiosError ? (error.response?.data as ApiError)?.detail || fallback : fallback;

export default function Fiscal() {
  const client = useQueryClient();
  const refresh = () => { client.invalidateQueries({ queryKey: ['fiscal-vendas-elegiveis'] }); client.invalidateQueries({ queryKey: ['fiscal-documentos'] }); };
  const eligible = useQuery<VendaElegivel[]>({ queryKey: ['fiscal-vendas-elegiveis'], queryFn: async () => { const { data } = await api.get('/fiscal/documentos/vendas-elegiveis/'); return data.results || data; } });
  const documents = useQuery<Documento[]>({ queryKey: ['fiscal-documentos'], queryFn: async () => { const { data } = await api.get('/fiscal/documentos/'); return data.results || data; } });
  const issue = useMutation({
    mutationFn: ({ venda, tipo }: { venda: number; tipo: 'NFCE' | 'NFE' }) => api.post('/fiscal/documentos/emitir/', { venda, tipo, canal: 'PDV' }),
    onSuccess: (_, variables) => { toast.success(`${variables.tipo === 'NFE' ? 'NF-e' : 'NFC-e'} processada pela SEFAZ.`); refresh(); },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Não foi possível emitir o documento fiscal.')),
  });
  const cancel = useMutation({
    mutationFn: ({ id, justificativa }: { id: string; justificativa: string }) => api.post(`/fiscal/documentos/${id}/cancelar/`, { justificativa }),
    onSuccess: () => { toast.success('Documento fiscal cancelado.'); refresh(); },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Não foi possível cancelar o documento.')),
  });
  const cancelDocument = (document: Documento) => {
    const reason = window.prompt('Justificativa do cancelamento (mínimo de 15 caracteres):');
    if (reason) cancel.mutate({ id: document.id, justificativa: reason });
  };
  const download = async (document: Documento, format: 'xml' | 'pdf') => {
    try {
      const response = await api.get(`/fiscal/documentos/${document.id}/${format}/`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const anchor = window.document.createElement('a');
      anchor.href = url; anchor.download = `${document.tipo_display}-${document.numero || document.id}.${format}`;
      if (format === 'pdf') anchor.target = '_blank';
      anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { toast.error(errorMessage(error, `Não foi possível obter o ${format.toUpperCase()}.`)); }
  };

  return <div className="animate-in">
    <div className="page-header"><h1 className="page-title">Notas fiscais</h1><p className="page-subtitle">Emissão de NF-e e NFC-e pela Geranet. Use homologação antes de ativar a produção.</p></div>
    <div className="card" style={{ marginBottom: 20, padding: 20 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 14 }}><div><h2 style={{ margin: 0, fontSize: '1rem' }}><ReceiptText size={18} style={{ verticalAlign: 'middle', marginRight: 7 }} />Vendas prontas para emitir</h2><small style={{ color: 'var(--text-muted)' }}>NFC-e para consumidor final; NF-e exige cliente e endereço fiscal completos.</small></div><button className="btn btn-ghost btn-sm" onClick={refresh}><RefreshCw size={15} />Atualizar</button></header>
      {eligible.isLoading ? <div className="loading">Carregando vendas...</div> : eligible.data?.length ? <div className="table-wrapper"><table className="table"><thead><tr><th>Venda</th><th>Cliente</th><th>Itens</th><th>Total</th><th /></tr></thead><tbody>{eligible.data.map(venda => <tr key={venda.id}><td>#{venda.id}</td><td>{venda.cliente_nome || 'Consumidor final'}</td><td>{venda.itens_count}</td><td>{money(venda.total_liquido)}</td><td style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button className="btn btn-primary btn-sm" disabled={issue.isPending} onClick={() => issue.mutate({venda:venda.id,tipo:'NFCE'})}><FileCheck2 size={15} />NFC-e</button><button className="btn btn-ghost btn-sm" disabled={issue.isPending || !venda.cliente_nome} onClick={() => issue.mutate({venda:venda.id,tipo:'NFE'})}><FileText size={15} />NF-e</button></td></tr>)}</tbody></table></div> : <p style={{ color: 'var(--text-muted)', margin: 0 }}>Nenhuma venda finalizada aguardando emissão.</p>}
    </div>
    <div className="card" style={{ padding: 20 }}><h2 style={{ margin: '0 0 14px', fontSize: '1rem' }}>Documentos recentes</h2>{documents.isLoading ? <div className="loading">Carregando documentos...</div> : documents.data?.length ? <div className="table-wrapper"><table className="table"><thead><tr><th>Venda</th><th>Documento</th><th>Status</th><th>Ambiente</th><th /></tr></thead><tbody>{documents.data.map(doc => <tr key={doc.id}><td>#{doc.venda_numero}</td><td>{doc.tipo_display}{doc.numero && <small style={{display:'block'}}>Nº {doc.numero} · Série {doc.serie}</small>}</td><td><span className={`badge ${doc.status === 'AUTORIZADA' ? 'badge-green' : doc.status === 'REJEITADA' || doc.status === 'ERRO' ? 'badge-red' : 'badge-yellow'}`}>{doc.status_display}</span>{doc.mensagem_sefaz && <small style={{ display: 'block', color: 'var(--text-muted)' }}>{doc.mensagem_sefaz}</small>}</td><td>{doc.ambiente}</td><td style={{display:'flex',gap:6,justifyContent:'flex-end'}}>{doc.pode_baixar_xml && <button className="btn btn-ghost btn-sm" onClick={()=>download(doc,'xml')}><Download size={14}/>XML</button>}{doc.pode_baixar_pdf && <button className="btn btn-ghost btn-sm" onClick={()=>download(doc,'pdf')}><Download size={14}/>PDF</button>}{doc.status === 'AUTORIZADA' && <button className="btn btn-ghost btn-sm" disabled={cancel.isPending} onClick={()=>cancelDocument(doc)}><XCircle size={14}/>Cancelar</button>}</td></tr>)}</tbody></table></div> : <p style={{ color: 'var(--text-muted)', margin: 0 }}>Nenhum documento fiscal emitido.</p>}</div>
  </div>;
}
