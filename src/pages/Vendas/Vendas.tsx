import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import {
  Search,
  Eye,
  Trash2,
  RefreshCw,
  SlidersHorizontal,
  RotateCcw,
  User,
  X,
  ShoppingCart,
  Printer,
  FileCheck2,
  FileText,
} from 'lucide-react';
import { cupomDaVenda } from '../../lib/cupom';
import { imprimirVenda } from '../../lib/impressaoVenda';
import { toast } from 'sonner';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import ConfirmModal from '../../components/ConfirmModal';
import Modal from '../../components/Modal';
import TotalsCards, { type Totals } from '../../components/TotalsCards';
import InfiniteScroll from '../../components/InfiniteScroll';
import { usePaginatedList } from '../../hooks/usePaginatedList';

interface VendaItem {
  id: number;
  produto_nome?: string;
  produto?: {
    nome: string;
    unidade_medida: string;
  };
  quantidade: number;
  preco_unitario: number;
  subtotal: number;
  unidade: string;
}

interface VendaPagamento {
  id: number;
  forma: string;
  valor: number;
}

interface Venda {
  id: number;
  data: string;
  cliente_nome: string;
  total: number;
  status: 'EM_ABERTO' | 'FINALIZADA' | 'CANCELADA';
  id_externo?: string;
  desconto?: number;
  itens: VendaItem[];
  pagamentos: VendaPagamento[];
}

type FiscalType = 'NFCE' | 'NFE';
type VendaElegivel = { id: number; data: string; cliente_nome?: string; total_liquido: string; itens_count: number };
type DocumentoFiscal = { tipo_display: string; status: string; status_display: string; mensagem_sefaz?: string };
type Paginated<T> = { count: number; next?: string | null; previous?: string | null; results: T[] };

const formatCurrency = (val: any) => {
  const num = Number(val);
  return isNaN(num) ? '0,00' : num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function Vendas() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // Sem data por padrão: mostra todas as vendas (a API já ordena das mais recentes).
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [isPrinting, setIsPrinting] = useState(false);
  const [issueConfirmation, setIssueConfirmation] = useState<{ venda: number; tipo: FiscalType } | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const saleId = searchParams.get('venda');
  const validSaleId = /^[1-9]\d*$/.test(saleId || '');
  const saleDetails = useQuery<Venda>({
    queryKey: ['vendas', 'detalhe', saleId],
    enabled: validSaleId,
    queryFn: async () => (await api.get(`/vendas/${saleId}/`)).data,
  });
  const selectedVenda = validSaleId ? saleDetails.data : undefined;
  const setSelectedVenda = (sale: Venda | null) => {
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      if (sale) next.set('venda', String(sale.id));
      else next.delete('venda');
      return next;
    }, { replace: !sale, preventScrollReset: true });
  };
  const [vendaParaCancelar, setVendaParaCancelar] = useState<{ id: number, justificativa?: string } | null>(null);

  const filterParams = {
    q: searchTerm,
    status: statusFilter || undefined,
    data_inicio: dateRange.start || undefined,
    data_fim: dateRange.end || undefined,
  };

  const lista = usePaginatedList<Venda>(
    ['vendas', searchTerm, statusFilter, dateRange],
    async (page) => {
      const resp = await api.get('/vendas/', {
        params: { ...filterParams, page }
      });
      return resp.data;
    }
  );
  const { items: vendas, isLoading, page, setPage, totalPages, isMobile } = lista;
  const filtrosAtivos = [searchTerm, dateRange.start, dateRange.end, statusFilter].filter(Boolean).length;

  const totals = useQuery<Record<'total' | 'finalizadas' | 'em_aberto' | 'canceladas', Totals>>({
    queryKey: ['vendas', 'totalizadores', searchTerm, statusFilter, dateRange],
    queryFn: async () => (await api.get('/vendas/totalizadores/', { params: filterParams })).data,
  });
  const eligible = useQuery<Paginated<VendaElegivel>>({
    queryKey: ['fiscal-vendas-elegiveis', selectedVenda?.id],
    enabled: selectedVenda?.status === 'FINALIZADA',
    queryFn: async () => (await api.get('/fiscal/documentos/vendas-elegiveis/', {
      params: { venda: selectedVenda!.id },
    })).data,
  });
  const canIssue = eligible.data?.results.some(venda => venda.id === selectedVenda?.id);

  const emitirDocumento = useMutation({
    mutationFn: ({ venda, tipo }: { venda: number; tipo: FiscalType }) => api.post<DocumentoFiscal>(
      '/fiscal/documentos/emitir/',
      { venda, tipo, canal: 'PDV' },
    ),
    onSuccess: ({ data }, variables) => {
      if (data.status === 'AUTORIZADA') {
        toast.success(`${variables.tipo === 'NFE' ? 'NF-e' : 'NFC-e'} autorizada pela SEFAZ.`);
      } else if (data.status === 'INDEFINIDO') {
        toast.warning(data.mensagem_sefaz || 'A comunicação terminou sem confirmação. Consulte a tela de notas fiscais.');
      } else {
        toast.error(data.mensagem_sefaz || `${data.tipo_display} retornou como ${data.status_display}.`);
      }
      queryClient.invalidateQueries({ queryKey: ['fiscal-vendas-elegiveis'] });
      queryClient.invalidateQueries({ queryKey: ['fiscal-documentos'] });
      queryClient.invalidateQueries({ queryKey: ['fiscal-monitor'] });
      queryClient.invalidateQueries({ queryKey: ['fiscal-totalizadores'] });
      setIssueConfirmation(null);
    },
    onError: (error: any) => {
      const detail = error.response?.data?.detail;
      const fieldError = error.response?.data && Object.values(error.response.data).find(value => Array.isArray(value)) as string[] | undefined;
      toast.error(detail || fieldError?.[0] || 'Não foi possível transmitir o documento fiscal.');
      queryClient.invalidateQueries({ queryKey: ['fiscal-vendas-elegiveis'] });
      queryClient.invalidateQueries({ queryKey: ['fiscal-documentos'] });
      queryClient.invalidateQueries({ queryKey: ['fiscal-totalizadores'] });
    },
  });

  const cancelarMutation = useMutation({
    mutationFn: ({ id, justificativa }: { id: number, justificativa?: string }) =>
      api.post(`/vendas/${id}/cancelar/`, { justificativa }),
    onSuccess: () => {
      toast.success('Venda cancelada com sucesso!');
      queryClient.invalidateQueries({ queryKey: ['vendas'] });
      queryClient.invalidateQueries({ queryKey: ['fiscal-totalizadores'] });
      queryClient.invalidateQueries({ queryKey: ['fiscal-vendas-elegiveis'] });
      queryClient.invalidateQueries({ queryKey: ['fiscal-monitor'] });
      setSelectedVenda(null);
      setVendaParaCancelar(null);
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || err.response?.data?.erro || 'Erro ao cancelar venda.';
      toast.error(msg);
    }
  });

  const handleImprimir = async (venda: Venda) => {
    if (isPrinting) return;
    setIsPrinting(true);
    try {
      await imprimirVenda(cupomDaVenda(venda));
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Não foi possível imprimir a venda. Tente novamente.');
    } finally {
      setIsPrinting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'FINALIZADA': return <span className="badge badge-green">Finalizada</span>;
      case 'CANCELADA': return <span className="badge badge-red">Cancelada</span>;
      case 'EM_ABERTO': return <span className="badge badge-yellow">Em Aberto</span>;
      default: return <span className="badge">{status}</span>;
    }
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <h1 className="page-title">Histórico de Vendas</h1>
        <p className="page-subtitle">Gerencie e consulte todas as transações realizadas no PDV.</p>
      </div>

      <section className="card sales-filters" aria-labelledby="sales-filters-title">
        <header className="sales-filters-header">
          <div className="sales-filters-title">
            <span className="sales-filters-icon"><SlidersHorizontal size={20} aria-hidden="true" /></span>
            <div><h2 id="sales-filters-title">Filtrar vendas</h2><p>{filtrosAtivos ? `${filtrosAtivos} filtro(s) ativo(s)` : 'Consulte por cliente, venda, período ou status'}</p></div>
          </div>
          <div className="sales-filters-actions">
            <button className="btn btn-ghost btn-sm" disabled={!filtrosAtivos} onClick={() => { setSearchTerm(''); setStatusFilter(''); setDateRange({ start: '', end: '' }); setPage(1); }}><RotateCcw size={15} />Limpar filtros</button>
            <button className="btn btn-primary btn-sm" disabled={totals.isFetching} onClick={() => queryClient.invalidateQueries({ queryKey: ['vendas'] })}><RefreshCw size={15} className={totals.isFetching ? 'button-spinner' : undefined} />Atualizar</button>
          </div>
        </header>
        <div className="sales-filters-grid">
          <div className="sales-filter-search">
            <label className="form-label" htmlFor="sales-search">Cliente ou número da venda</label>
            <div className="search-input-wrapper">
              <Search className="search-icon" size={18} aria-hidden="true" />
              <input id="sales-search" type="search" className="input" placeholder="Nome do cliente ou # da venda" value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setPage(1); }} />
            </div>
          </div>
          <div><label className="form-label" htmlFor="sales-date-start">Data inicial</label>
            <input id="sales-date-start" type="date" className="input" value={dateRange.start} onChange={e => { setDateRange(prev => ({ ...prev, start: e.target.value })); setPage(1); }} />
          </div>
          <div><label className="form-label" htmlFor="sales-date-end">Data final</label>
            <input id="sales-date-end" type="date" className="input" value={dateRange.end} onChange={e => { setDateRange(prev => ({ ...prev, end: e.target.value })); setPage(1); }} />
          </div>
          <div><label className="form-label" htmlFor="sales-status">Status da venda</label>
            <select id="sales-status" className="input" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
              <option value="">Todos os status</option><option value="FINALIZADA">Finalizadas</option><option value="CANCELADA">Canceladas</option><option value="EM_ABERTO">Em aberto</option>
            </select>
          </div>
        </div>
      </section>

      <TotalsCards loading={totals.isFetching} error={totals.isError} items={[
        { label: 'Vendas encontradas', totals: totals.data?.total },
        { label: 'Finalizadas', totals: totals.data?.finalizadas },
        { label: 'Em aberto', totals: totals.data?.em_aberto },
        { label: 'Canceladas', totals: totals.data?.canceladas },
      ]} />
      <p className="sales-summary-note">Quantidades e valores líquidos de desconto de todas as páginas, conforme os filtros selecionados. Canceladas não compõem o total de finalizadas.</p>

      {saleId && (saleDetails.isLoading || saleDetails.isError || !validSaleId) && <div className="card" style={{ padding: 16, marginBottom: 20 }} role="status">
        {saleDetails.isLoading ? 'Carregando detalhes da venda...' : 'Não foi possível abrir esta venda. Ela pode estar indisponível ou você não possui acesso.'}
        {!saleDetails.isLoading && <button className="btn btn-ghost btn-sm" onClick={() => setSelectedVenda(null)}>Voltar ao histórico</button>}
      </div>}

      {/* LISTA (mobile) */}
      {isMobile ? (
        <div className="m-list">
          {isLoading ? (
            <div className="loading">Carregando vendas...</div>
          ) : vendas.length === 0 ? (
            <div className="m-empty">Nenhuma venda encontrada.</div>
          ) : vendas.map((v) => (
            <div key={v.id} className="m-card clickable" onClick={() => setSelectedVenda(v)}>
              <div className="m-card-head">
                <div>
                  <div className="m-card-title">Venda #{String(v.id).slice(-6).toUpperCase()}</div>
                  <div className="m-card-sub">{new Date(v.data).toLocaleString('pt-BR')}</div>
                </div>
                {getStatusBadge(v.status)}
              </div>
              <div className="m-card-head" style={{ alignItems: 'center' }}>
                <div className="m-card-meta"><span><User size={13} /> {v.cliente_nome || 'Consumidor Final'}</span></div>
                <div className="m-card-value">R$ {formatCurrency(Number(v.total) - Number(v.desconto || 0))}</div>
              </div>
            </div>
          ))}
          <InfiniteScroll hasMore={!!lista.hasNextPage} loading={lista.isFetchingNextPage} onLoadMore={lista.fetchNextPage} />
        </div>
      ) : (
      /* TABELA */
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Data / Hora</th>
                <th>Cliente</th>
                <th>Total</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="loading">Carregando vendas...</td></tr>
              ) : vendas?.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Nenhuma venda encontrada.</td></tr>
              ) : (
                vendas?.map((v, idx) => (
                  <tr key={`${v.id}-${idx}`}>
                    <td style={{ fontWeight: 700 }}>#{String(v.id).slice(-6).toUpperCase()}</td>
                    <td>{new Date(v.data).toLocaleString('pt-BR')}</td>
                    <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                           <User size={14} className="text-muted" />
                           {v.cliente_nome || 'Consumidor Final'}
                        </div>
                    </td>
                    <td style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                      R$ {formatCurrency(Number(v.total) - Number(v.desconto || 0))}
                    </td>
                    <td>{getStatusBadge(v.status)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setSelectedVenda(v)}>
                        <Eye size={16} />
                        Detalhes
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, padding: '16px', borderTop: '1px solid var(--border)' }}>
            <button
              className="btn btn-ghost btn-sm"
              disabled={page === 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              Anterior
            </button>
            <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Página {page} de {totalPages}</span>
            <button
              className="btn btn-ghost btn-sm"
              disabled={page === totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              Próxima
            </button>
          </div>
        )}
      </div>
      )}

      {/* MODAL DE DETALHES */}
      {selectedVenda && (
        <Modal
          onClose={() => setSelectedVenda(null)}
          labelledBy="sale-details-title"
          panelClassName="card animate-in"
          panelStyle={{ width: '100%', maxWidth: 1000, padding: 0, overflow: 'hidden' }}
          overlayStyle={{ zIndex: 1000 }}
        >
            <div className="sale-detail-header" style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ flex: 1 }}>
                <h2 id="sale-details-title" style={{ fontSize: '1.25rem', fontWeight: 900 }}>Venda #{selectedVenda?.id ? String(selectedVenda.id).slice(-6).toUpperCase() : '---'}</h2>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
                   {selectedVenda?.data ? new Date(selectedVenda.data).toLocaleString('pt-BR') : 'Data Indisponível'} · {selectedVenda?.cliente_nome || 'Consumidor Final'}
                </div>
              </div>
              <button onClick={() => setSelectedVenda(null)} className="btn btn-ghost btn-icon" aria-label="Fechar detalhes da venda">
                <X size={24} />
              </button>
            </div>

            <div className="sale-detail-body" style={{ padding: '32px', maxHeight: '70vh', overflowY: 'auto' }}>
               {selectedVenda.status !== 'EM_ABERTO' && <section style={{ marginBottom: 24 }} aria-label="Nota fiscal da venda">
                 <h3 style={{ marginBottom: 10 }}>Nota fiscal</h3>
                 {eligible.isLoading ? <p>Consultando situação fiscal...</p> : eligible.isError ? <p>Não foi possível consultar a emissão. <button className="btn btn-ghost btn-sm" onClick={() => eligible.refetch()}>Tentar novamente</button></p> : canIssue ? <>
                   <p style={{ color: 'var(--text-muted)' }}>NFC-e para consumidor final; NF-e exige cliente e endereço fiscal completos.</p>
                   <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                     <button className="btn btn-primary" disabled={emitirDocumento.isPending} onClick={() => setIssueConfirmation({ venda: selectedVenda.id, tipo: 'NFCE' })}><FileCheck2 size={16} />Emitir NFC-e</button>
                     <button className="btn btn-ghost" disabled={emitirDocumento.isPending || !selectedVenda.cliente_nome} onClick={() => setIssueConfirmation({ venda: selectedVenda.id, tipo: 'NFE' })}><FileText size={16} />Emitir NF-e</button>
                   </div>
                 </> : <p style={{ color: 'var(--text-muted)' }}>Esta venda não está disponível para uma nova emissão. Consulte o documento e suas opções em Notas fiscais.</p>}
                 <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/fiscal?venda=${selectedVenda.id}`)}>Ver notas fiscais da venda</button>
               </section>}
               {selectedVenda.status === 'EM_ABERTO' && <Link className="btn btn-ghost btn-sm" to={`/fiscal?venda=${selectedVenda.id}`} style={{ marginBottom: 20 }}>Ver notas fiscais da venda</Link>}
               <div style={{ marginBottom: 32 }}>
                  <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>Itens da Venda</h3>
                  <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                     {selectedVenda.itens?.map((item, idx) => (
                       <div key={`item-${item.id}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid var(--border)' }}>
                          <div>
                             <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                               {item?.produto?.nome || item?.produto_nome || 'Produto desconhecido'}
                             </div>
                             <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item?.quantidade} x R$ {formatCurrency(item?.preco_unitario)}</div>
                          </div>
                          <div style={{ fontWeight: 800 }}>R$ {formatCurrency(item?.subtotal)}</div>
                       </div>
                     ))}
                  </div>
               </div>

               <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
                  <div>
                     <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>Pagamento</h3>
                     <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {selectedVenda.pagamentos?.map((p, idx) => (
                          <div key={`p-${p.id}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                             <span style={{ color: 'var(--text-secondary)' }}>{p?.forma || 'Pagamento'}</span>
                             <span style={{ fontWeight: 700 }}>R$ {formatCurrency(p?.valor)}</span>
                          </div>
                        ))}
                     </div>
                  </div>
                  <div style={{ background: 'rgba(59, 130, 246, 0.05)', padding: 20, borderRadius: 16, border: '1px solid rgba(59, 130, 246, 0.1)' }}>
                     <div className="kpi-label" style={{ color: 'var(--accent)' }}>Total da Transação</div>
                     <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                        R$ {formatCurrency(Number(selectedVenda.total) - Number(selectedVenda.desconto || 0))}
                     </div>
                     {(selectedVenda.desconto || 0) > 0 && (
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 4 }}>
                          Subtotal: R$ {formatCurrency(selectedVenda.total)} | Desconto: -R$ {formatCurrency(selectedVenda.desconto)}
                        </div>
                     )}
                     <div style={{ marginTop: 8 }}>{getStatusBadge(selectedVenda.status)}</div>
                  </div>
               </div>
            </div>

            <div className="sale-detail-footer" style={{ padding: '24px 32px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', background: 'rgba(255,255,255,0.01)' }}>

               <div className="sale-detail-actions" style={{ display: 'flex', gap: 12 }}>
                {selectedVenda.status === 'FINALIZADA' && (
                  <>
                    <button
                      className="btn btn-ghost"
                      style={{ color: 'var(--accent-green)', background: 'rgba(16, 185, 129, 0.1)' }}
                      disabled={isPrinting}
                      onClick={() => handleImprimir(selectedVenda)}
                    >
                      <Printer size={16} />
                      {isPrinting ? 'Preparando impressão...' : 'Reimprimir'}
                    </button>

                    <button
                      className="btn btn-danger"
                      onClick={() => {
                        setVendaParaCancelar({ id: selectedVenda.id });
                      }}
                      disabled={cancelarMutation.isPending}
                    >
                      <Trash2 size={16} />
                      Cancelar Venda
                    </button>

                  </>
                )}

                {selectedVenda.status === 'EM_ABERTO' && (
                  <button
                    className="btn btn-primary"
                    onClick={() => navigate(`/pdv?venda_id=${selectedVenda.id}`)}
                  >
                    <ShoppingCart size={16} />
                    Continuar no PDV
                  </button>
                )}
               </div>
            </div>
        </Modal>
      )}

      <ConfirmModal
        isOpen={!!vendaParaCancelar}
        title="Cancelar Venda"
        description="Tem certeza que deseja cancelar esta venda? O estoque será devolvido."
        confirmLabel="Cancelar Venda"
        onConfirm={() => vendaParaCancelar && cancelarMutation.mutate(vendaParaCancelar)}
        onClose={() => setVendaParaCancelar(null)}
        isLoading={cancelarMutation.isPending}
      />

      <ConfirmModal isOpen={!!issueConfirmation} title="Confirmar emissão de nota fiscal"
        description={`Emitir ${issueConfirmation?.tipo === 'NFE' ? 'NF-e' : 'NFC-e'} da venda #${issueConfirmation?.venda}? A transmissão será feita no ambiente fiscal configurado.`}
        confirmLabel="Emitir nota" isDanger={false} isLoading={emitirDocumento.isPending}
        onClose={() => setIssueConfirmation(null)} onConfirm={() => issueConfirmation && emitirDocumento.mutate(issueConfirmation)} />

      {/* CSS LOCAIS PARA O HISTÓRICO */}
      <style>{`
        .badge {
          padding: 4px 8px;
          border-radius: 6px;
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
        }
        .btn-danger {
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }
        .btn-danger:hover {
          background: #ef4444;
          color: white;
        }
      `}</style>
    </div>
  );
}
