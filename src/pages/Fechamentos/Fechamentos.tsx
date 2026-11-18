import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Printer, RefreshCw, Wallet, X, ReceiptText } from 'lucide-react';
import { listarTodasPaginas } from '../../lib/listarTodasPaginas';
import './Fechamentos.css';
import api from '../../lib/api';
import ConfirmModal from '../../components/ConfirmModal';
import { useAuthStore } from '../../store/authStore';
import { toast } from 'sonner';
import { imprimirFechamento, type RelatorioFechamento } from '../../lib/impressao';

const formas: Record<string, string> = { DINHEIRO: 'Dinheiro', PIX: 'Pix', CARTAO_DEBITO: 'Débito', CARTAO_CREDITO: 'Crédito', FIADO: 'Fiado' };
const statusVenda: Record<string, string> = { FINALIZADA: 'Finalizada', EM_ABERTO: 'Em aberto', CANCELADA: 'Cancelada', ORCAMENTO: 'Orçamento' };
const moeda = (v: string | number | null) => v === null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
// Fechamento cego: o backend só envia esperado/diferença à gerência depois do fechamento.
const conferencia = (v: string | null) => v === null ? 'Na impressão' : moeda(v);
const dataHora = (v: string | null) => v ? new Date(v).toLocaleString('pt-BR') : 'Em aberto';
type Operacao = { id: number; tipo: string; valor: string; motivo: string; created_at: string };
type Fechamento = {
  id: number; operador: number; operador_nome: string; status: string; aberta_em: string; fechada_em: string | null;
  fundo_inicial: string; valor_contado: string | null; diferenca_caixa: string | null; observacoes: string;
  resumo: {
    quantidade_vendas: number; quantidade_total: number; quantidade_abertas: number; quantidade_canceladas: number; quantidade_orcamentos: number;
    total_bruto: string; descontos: string; total_liquido: string; ticket_medio: string;
    total_sangrias: string; total_suprimentos: string; saldo_esperado: string | null;
    por_forma: Record<string, { valor: string; quantidade: number }>; operacoes: Operacao[];
  };
};
type Venda = { id: number; data: string; cliente_nome: string | null; status: string; total: string; desconto: string; pagamentos: { forma: string; valor: string }[] };

export default function Fechamentos() {
  const usuario = useAuthStore(state => state.user);
  const queryClient = useQueryClient();
  const [confirmarFechamento, setConfirmarFechamento] = useState<Fechamento | null>(null);
  const [valorContado, setValorContado] = useState('');
  const [erroFechamento, setErroFechamento] = useState('');
  const fechar = useMutation({
    mutationFn: () => api.post(`/sessoes-caixa/${confirmarFechamento!.id}/fechar/`, { valor_contado: valorContado }),
    onSuccess: ({ data }) => {
      setConfirmarFechamento(null);
      toast.success('Caixa fechado com sucesso.');
      if (data?.relatorio) void imprimir(data.relatorio);
      void queryClient.invalidateQueries({ queryKey: ['fechamentos'] });
      void queryClient.invalidateQueries({ queryKey: ['sessao-ativa'] });
      void queryClient.invalidateQueries({ queryKey: ['fechamentos-vendas'] });
      void queryClient.invalidateQueries({ queryKey: ['vendas'] });
    },
    onError: (error: unknown) => {
      const resposta = (error as { response?: { data?: { erro?: string; detail?: string } } }).response?.data;
      setErroFechamento(resposta?.erro || resposta?.detail || 'Não foi possível fechar o caixa. Tente novamente.');
    },
  });
  const [imprimindo, setImprimindo] = useState(false);
  const imprimir = async (relatorio: RelatorioFechamento | number) => {
    setImprimindo(true);
    try {
      const dados = typeof relatorio === 'number'
        ? (await api.get<RelatorioFechamento>(`/sessoes-caixa/${relatorio}/relatorio/`)).data
        : relatorio;
      await imprimirFechamento(dados);
    } catch (error) {
      const resposta = (error as { response?: { data?: { erro?: string; detail?: string } }; message?: string });
      toast.error(resposta.response?.data?.erro || resposta.response?.data?.detail || resposta.message || 'Não foi possível imprimir o fechamento.');
    } finally {
      setImprimindo(false);
    }
  };
  const hoje = new Date();
  const [inicio, setInicio] = useState(new Date(hoje.getFullYear(), hoje.getMonth(), 1).toLocaleDateString('sv-SE'));
  const [fim, setFim] = useState(hoje.toLocaleDateString('sv-SE'));
  const [status, setStatus] = useState('');
  const [busca, setBusca] = useState('');
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [buscaVenda, setBuscaVenda] = useState('');
  const [situacaoVenda, setSituacaoVenda] = useState('');
  const periodoValido = !inicio || !fim || inicio <= fim;
  const consulta = useQuery({
    queryKey: ['fechamentos', inicio, fim, status],
    queryFn: () => listarTodasPaginas<Fechamento>('/sessoes-caixa/gestao/', { data_inicio: inicio, data_fim: fim, status }),
    enabled: periodoValido,
  });
  const caixas = (consulta.data ?? []).filter(c => `${c.id} ${c.operador_nome}`.toLocaleLowerCase().includes(busca.toLocaleLowerCase().replace(/^#/, '').trim()));
  const caixa = caixas.find(c => c.id === selecionado);
  const vendas = useQuery({
    queryKey: ['fechamentos-vendas', caixa?.id],
    queryFn: () => listarTodasPaginas<Venda>('/vendas/', { sessao: caixa!.id }),
    enabled: Boolean(caixa),
  });
  const soma = (fn: (c: Fechamento) => number) => caixas.reduce((t, c) => t + fn(c), 0);
  const pagamentos = Object.entries(formas).map(([forma, label]) => ({
    forma, label, valor: soma(c => Number(c.resumo.por_forma[forma]?.valor ?? 0)),
    quantidade: soma(c => c.resumo.por_forma[forma]?.quantidade ?? 0),
  }));
  const vendasVisiveis = (vendas.data ?? []).filter(v => (!situacaoVenda || v.status === situacaoVenda) && `${v.id} ${v.cliente_nome ?? ''}`.toLocaleLowerCase().includes(buscaVenda.toLocaleLowerCase().replace(/^#/, '').trim()));
  const pronto = periodoValido && !consulta.isLoading && !consulta.isError;
  const mudarFiltro = (setter: (value: string) => void, value: string) => { setter(value); setSelecionado(null); };
  // Os detalhes ficam abaixo da tabela de caixas; sem rolar até eles, o clique parece não fazer nada.
  const detalhesRef = useRef<HTMLElement>(null);
  const [focoDetalhes, setFocoDetalhes] = useState(0);
  useEffect(() => { if (focoDetalhes) detalhesRef.current?.scrollIntoView({ block: 'start' }); }, [focoDetalhes]);
  const abrir = (id: number) => { setSelecionado(id); setBuscaVenda(''); setSituacaoVenda(''); setFocoDetalhes(n => n + 1); };

  return <div className="animate-in closings-page">
    <header className="page-header closings-heading"><div><h1 className="page-title">Fechamento de caixa</h1><p className="page-subtitle">Conferência financeira por sessão e operador</p></div><button className="btn btn-ghost" disabled={consulta.isFetching} onClick={() => { void consulta.refetch(); if (caixa) void vendas.refetch(); }}><RefreshCw size={16} /> Atualizar</button></header>
    <section className="card closings-filters" aria-label="Filtros de fechamento">
      <label>Abertura a partir de<input className="input" type="date" value={inicio} onChange={e => mudarFiltro(setInicio, e.target.value)} /></label>
      <label>Abertura até<input className="input" type="date" value={fim} onChange={e => mudarFiltro(setFim, e.target.value)} /></label>
      <label>Situação<select className="input" value={status} onChange={e => mudarFiltro(setStatus, e.target.value)}><option value="">Todos os caixas</option><option value="ABERTA">Abertos</option><option value="FECHADA">Fechados</option></select></label>
      <label>Buscar caixa ou operador<input className="input" placeholder="Número ou nome do operador" value={busca} onChange={e => mudarFiltro(setBusca, e.target.value)} /></label>
    </section>
    {!periodoValido && <p role="alert">A data inicial deve ser anterior ou igual à data final.</p>}
    {consulta.isError && <p role="alert">Não foi possível carregar os fechamentos. Tente atualizar.</p>}
    <section className="closings-kpis" aria-label="Totalizadores dos caixas filtrados">
      {[
        ['Vendas finalizadas', moeda(soma(c => Number(c.resumo.total_liquido))), `${soma(c => c.resumo.quantidade_vendas)} vendas · valor líquido`],
        ['Caixas no período', String(caixas.length), `${caixas.filter(c => c.status === 'ABERTA').length} abertos · ${caixas.filter(c => c.status === 'FECHADA').length} fechados`],
        ['Dinheiro esperado', caixas.some(c => c.resumo.saldo_esperado === null) ? 'Na impressão' : moeda(soma(c => Number(c.resumo.saldo_esperado))), caixas.some(c => c.resumo.saldo_esperado === null) ? 'Caixa aberto ou sem permissão: aparece só no fechamento impresso' : 'Fundo + vendas em dinheiro + suprimentos − sangrias'],
        ['Diferença nos fechados', moeda(soma(c => Number(c.diferenca_caixa ?? 0))), `${caixas.filter(c => c.diferenca_caixa !== null && Number(c.diferenca_caixa) !== 0).length} caixas com diferença`],
      ].map(([label, valor, nota]) => <div className="card" key={label}><span className="kpi-label">{label}</span><strong>{pronto ? valor : '—'}</strong><small>{pronto ? nota : 'Aguardando consulta'}</small></div>)}
    </section>
    <section className="card closings-section"><h2>Pagamentos do período</h2><p className="text-muted">Somente vendas finalizadas dos caixas filtrados. Uma venda pode utilizar mais de uma forma de pagamento.</p><div className="closings-payments">{pagamentos.map(p => <div key={p.forma}><span>{p.label}</span><strong>{pronto ? moeda(p.valor) : '—'}</strong><small>{pronto ? `${p.quantidade} vendas` : '—'}</small></div>)}</div></section>
    <section className="card closings-section"><h2>Caixas e fechamentos</h2><p className="text-muted">Período filtrado pela data de abertura. Os valores incluem toda a sessão, até o seu fechamento.</p>
      {consulta.isLoading ? <p className="loading">Carregando todos os caixas...</p> : pronto && !caixas.length ? <p className="empty-state">Nenhum caixa encontrado para os filtros.</p> : pronto && <div className="table-wrapper"><table className="table closings-table"><thead><tr><th>Caixa / operador</th><th>Abertura / fechamento</th><th>Situação</th><th>Vendas</th><th>Bruto / descontos</th><th>Líquido</th>{Object.values(formas).map(f => <th key={f}>{f}</th>)}<th>Fundo inicial</th><th>Suprimentos</th><th>Sangrias</th><th>Dinheiro esperado</th><th>Contado</th><th>Diferença</th><th>Detalhes</th></tr></thead><tbody>{caixas.map(c => <tr key={c.id} className={selecionado === c.id ? 'closing-selected' : ''}><td><strong>#{c.id}</strong><small>{c.operador_nome}</small></td><td>{dataHora(c.aberta_em)}<small>{dataHora(c.fechada_em)}</small></td><td><span className={`badge ${c.status === 'FECHADA' ? 'badge-blue' : 'badge-green'}`}>{c.status === 'FECHADA' ? 'Fechado' : 'Aberto'}</span></td><td><strong>{c.resumo.quantidade_vendas} finalizadas</strong><small>{c.resumo.quantidade_abertas} abertas · {c.resumo.quantidade_canceladas} canceladas</small></td><td>{moeda(c.resumo.total_bruto)}<small>Descontos: {moeda(c.resumo.descontos)}</small></td><td><strong>{moeda(c.resumo.total_liquido)}</strong></td>{Object.keys(formas).map(f => <td key={f}>{moeda(c.resumo.por_forma[f]?.valor ?? 0)}<small>{c.resumo.por_forma[f]?.quantidade ?? 0} vendas</small></td>)}<td>{moeda(c.fundo_inicial)}</td><td>{moeda(c.resumo.total_suprimentos)}</td><td>{moeda(c.resumo.total_sangrias)}</td><td>{conferencia(c.resumo.saldo_esperado)}</td><td>{moeda(c.valor_contado)}</td><td className={c.diferenca_caixa !== null && Number(c.diferenca_caixa) !== 0 ? 'text-danger' : ''}>{c.status === 'ABERTA' ? '—' : conferencia(c.diferenca_caixa)}</td><td><button className="btn btn-ghost btn-sm" onClick={() => abrir(c.id)}><ReceiptText size={16} /> Ver vendas e detalhes</button></td></tr>)}</tbody></table></div>}
    </section>
    {caixa && <section ref={detalhesRef} className="card closings-section" aria-label={`Detalhes do caixa ${caixa.id}`}>
      <header className="closings-heading"><div><h2><Wallet size={19} /> Caixa #{caixa.id} · {caixa.operador_nome}</h2><p>{dataHora(caixa.aberta_em)} → {dataHora(caixa.fechada_em)}</p></div><button className="btn btn-ghost" onClick={() => setSelecionado(null)} aria-label="Fechar detalhes do caixa"><X size={18} /></button></header>
      {caixa.status === 'ABERTA' && caixa.operador === usuario?.id && <div><button className="btn btn-primary" onClick={() => { setConfirmarFechamento(caixa); setValorContado(''); setErroFechamento(''); }}>Fechar este caixa</button>{caixa.resumo.quantidade_abertas > 0 && <p>As vendas em aberto serão canceladas automaticamente ao confirmar o fechamento.</p>}</div>}
      {caixa.status === 'FECHADA' && (caixa.operador === usuario?.id || caixa.resumo.saldo_esperado !== null) && <div><button className="btn btn-primary" disabled={imprimindo} onClick={() => void imprimir(caixa.id)}><Printer size={16} /> {imprimindo ? 'Preparando impressão...' : 'Imprimir fechamento'}</button></div>}
      <div className="closings-detail-grid">{[
        ['Vendas finalizadas', String(caixa.resumo.quantidade_vendas)], ['Em aberto', String(caixa.resumo.quantidade_abertas)], ['Canceladas', String(caixa.resumo.quantidade_canceladas)], ['Orçamentos', String(caixa.resumo.quantidade_orcamentos)],
        ['Bruto', moeda(caixa.resumo.total_bruto)], ['Descontos', moeda(caixa.resumo.descontos)], ['Líquido', moeda(caixa.resumo.total_liquido)], ['Ticket médio', moeda(caixa.resumo.ticket_medio)],
        ['Fundo inicial', moeda(caixa.fundo_inicial)], ['Suprimentos', moeda(caixa.resumo.total_suprimentos)], ['Sangrias', moeda(caixa.resumo.total_sangrias)], ['Dinheiro esperado', conferencia(caixa.resumo.saldo_esperado)], ['Contado', moeda(caixa.valor_contado)], ['Diferença', caixa.status === 'ABERTA' ? '—' : conferencia(caixa.diferenca_caixa)],
      ].map(([label, valor]) => <div key={label}><span>{label}</span><strong>{valor}</strong></div>)}</div>
      <p className="text-muted">Dinheiro esperado e diferença aparecem só na impressão e, para a gerência, depois do fechamento. Diferença = contado − esperado. Valor negativo indica falta; positivo indica sobra. Pix, cartões e fiado não entram no saldo de dinheiro físico.</p>
      {caixa.observacoes && <p><strong>Observações:</strong> {caixa.observacoes}</p>}
      <h3>Movimentações do caixa</h3>{!caixa.resumo.operacoes.length ? <p>Nenhuma sangria ou suprimento nesta sessão.</p> : <div className="table-wrapper"><table className="table"><thead><tr><th>Data</th><th>Tipo</th><th>Motivo</th><th>Valor</th></tr></thead><tbody>{caixa.resumo.operacoes.map(o => <tr key={o.id}><td>{dataHora(o.created_at)}</td><td>{o.tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento'}</td><td>{o.motivo || '—'}</td><td>{moeda(o.valor)}</td></tr>)}</tbody></table></div>}
      <h3>Todas as vendas da sessão</h3><div className="closings-filters closings-sale-filters"><label>Buscar venda ou cliente<input className="input" value={buscaVenda} onChange={e => setBuscaVenda(e.target.value)} placeholder="Número da venda ou cliente" /></label><label>Status da venda<select className="input" value={situacaoVenda} onChange={e => setSituacaoVenda(e.target.value)}><option value="">Todos os status</option>{Object.entries(statusVenda).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      {vendas.isLoading ? <p className="loading">Carregando todas as vendas...</p> : vendas.isError ? <p role="alert">Não foi possível carregar as vendas. Atualize para tentar novamente.</p> : <><p>{vendasVisiveis.length} de {vendas.data?.length ?? 0} vendas da sessão</p><div className="table-wrapper"><table className="table"><thead><tr><th>Venda</th><th>Data / hora</th><th>Cliente</th><th>Status</th><th>Pagamentos</th><th>Bruto</th><th>Desconto</th><th>Líquido</th><th>Detalhes</th></tr></thead><tbody>{vendasVisiveis.map(v => <tr key={v.id}><td>#{v.id}</td><td>{dataHora(v.data)}</td><td>{v.cliente_nome || 'Consumidor não identificado'}</td><td><span className={`badge ${v.status === 'FINALIZADA' ? 'badge-green' : 'badge-blue'}`}>{statusVenda[v.status] ?? v.status}</span></td><td>{v.pagamentos.map((p, i) => <small key={i}>{formas[p.forma] ?? p.forma}: {moeda(p.valor)}</small>)}</td><td>{moeda(v.total)}</td><td>{moeda(v.desconto)}</td><td>{moeda(Number(v.total) - Number(v.desconto))}</td><td><Link className="btn btn-ghost btn-sm" to={`/vendas?venda=${v.id}`}>Ver venda</Link></td></tr>)}</tbody></table></div>{!vendasVisiveis.length && <p>Nenhuma venda encontrada.</p>}</>}
    </section>}
    <ConfirmModal isOpen={Boolean(confirmarFechamento)} title={`Fechar caixa #${confirmarFechamento?.id ?? ''}?`} description="Confira o dinheiro físico disponível. Ao confirmar, todas as vendas em aberto desta sessão serão canceladas automaticamente e o caixa será encerrado." confirmLabel="Confirmar fechamento" isDanger={false} isLoading={fechar.isPending} confirmDisabled={!valorContado.trim() || !Number.isFinite(Number(valorContado)) || Number(valorContado) < 0} onClose={() => setConfirmarFechamento(null)} onConfirm={() => fechar.mutate()}>
      <div style={{ textAlign: 'left', marginBottom: 24 }}><label>Dinheiro contado no caixa (R$) *<input className="input" type="number" min="0" step="0.01" required autoFocus value={valorContado} disabled={fechar.isPending} onChange={e => setValorContado(e.target.value)} placeholder="Conte as notas e moedas" /></label><p className="text-muted">Conte todo o dinheiro da gaveta, inclusive o fundo inicial. O valor esperado e a diferença saem só na impressão do fechamento.</p>{erroFechamento && <p role="alert">{erroFechamento}</p>}</div>
    </ConfirmModal>
  </div>;
}
