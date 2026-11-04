import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, RefreshCw, ReceiptText } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';

type VendaElegivel = { id: number; data: string; cliente_nome?: string; total_liquido: string; itens_count: number };
type Documento = { id: string; venda_numero: number; tipo_display: string; status: string; status_display: string; ambiente: string; mensagem_sefaz?: string };
const money = (value: string | number) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function Fiscal() {
  const client = useQueryClient();
  const eligible = useQuery<VendaElegivel[]>({ queryKey: ['fiscal-vendas-elegiveis'], queryFn: async () => { const { data } = await api.get('/fiscal/documentos/vendas-elegiveis/'); return data.results || data; } });
  const documents = useQuery<Documento[]>({ queryKey: ['fiscal-documentos'], queryFn: async () => { const { data } = await api.get('/fiscal/documentos/'); return data.results || data; } });
  const issue = useMutation({
    mutationFn: (venda: number) => api.post('/fiscal/documentos/emitir/', { venda, tipo: 'NFCE', canal: 'PDV' }),
    onSuccess: () => { toast.success('NFC-e enviada para autorização.'); client.invalidateQueries({ queryKey: ['fiscal-vendas-elegiveis'] }); client.invalidateQueries({ queryKey: ['fiscal-documentos'] }); },
    onError: (error: any) => toast.error(error.response?.data?.detail || 'Não foi possível emitir a NFC-e.'),
  });
  return <div className="animate-in">
    <div className="page-header"><h1 className="page-title">Notas fiscais</h1><p className="page-subtitle">Emita NFC-e somente após concluir a venda. A autorização depende da SEFAZ.</p></div>
    <div className="card" style={{ marginBottom: 20, padding: 20 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 14 }}><div><h2 style={{ margin: 0, fontSize: '1rem' }}><ReceiptText size={18} style={{ verticalAlign: 'middle', marginRight: 7 }} />Vendas prontas para emitir</h2><small style={{ color: 'var(--text-muted)' }}>A emissão não é automática: confira os dados fiscais antes de enviar.</small></div><button className="btn btn-ghost btn-sm" onClick={() => { client.invalidateQueries({ queryKey: ['fiscal-vendas-elegiveis'] }); client.invalidateQueries({ queryKey: ['fiscal-documentos'] }); }}><RefreshCw size={15} />Atualizar</button></header>
      {eligible.isLoading ? <div className="loading">Carregando vendas...</div> : eligible.data?.length ? <div className="table-wrapper"><table className="table"><thead><tr><th>Venda</th><th>Cliente</th><th>Itens</th><th>Total</th><th /></tr></thead><tbody>{eligible.data.map(venda => <tr key={venda.id}><td>#{venda.id}</td><td>{venda.cliente_nome || 'Consumidor final'}</td><td>{venda.itens_count}</td><td>{money(venda.total_liquido)}</td><td><button className="btn btn-primary btn-sm" disabled={issue.isPending} onClick={() => issue.mutate(venda.id)}><FileCheck2 size={15} />Emitir NFC-e</button></td></tr>)}</tbody></table></div> : <p style={{ color: 'var(--text-muted)', margin: 0 }}>Nenhuma venda finalizada aguardando emissão.</p>}
    </div>
    <div className="card" style={{ padding: 20 }}><h2 style={{ margin: '0 0 14px', fontSize: '1rem' }}>Documentos recentes</h2>{documents.isLoading ? <div className="loading">Carregando documentos...</div> : documents.data?.length ? <div className="table-wrapper"><table className="table"><thead><tr><th>Venda</th><th>Tipo</th><th>Status</th><th>Ambiente</th></tr></thead><tbody>{documents.data.map(doc => <tr key={doc.id}><td>#{doc.venda_numero}</td><td>{doc.tipo_display}</td><td><span className={`badge ${doc.status === 'AUTORIZADA' ? 'badge-green' : doc.status === 'REJEITADA' || doc.status === 'ERRO' ? 'badge-red' : 'badge-yellow'}`}>{doc.status_display}</span>{doc.mensagem_sefaz && <small style={{ display: 'block', color: 'var(--text-muted)' }}>{doc.mensagem_sefaz}</small>}</td><td>{doc.ambiente}</td></tr>)}</tbody></table></div> : <p style={{ color: 'var(--text-muted)', margin: 0 }}>Nenhum documento fiscal emitido.</p>}</div>
  </div>;
}
