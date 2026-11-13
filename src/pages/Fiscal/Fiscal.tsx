import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { Activity, Ban, Download, FileCheck2, FileText, PenLine, RefreshCw, Repeat2, ReceiptText, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

type FiscalType = 'NFCE' | 'NFE';
type VendaElegivel = { id: number; data: string; cliente_nome?: string; total_liquido: string; itens_count: number };
type Documento = { id: string; venda_numero: number; tipo: FiscalType; tipo_display: string; status: string; status_display: string; ambiente: string; mensagem_sefaz?: string; numero?: string; serie?: string; chave_acesso?: string; pode_baixar_xml: boolean; pode_baixar_pdf: boolean; pode_cancelar: boolean; prazo_cancelamento_em?: string | null; motivo_cancelamento?: string };
type Inutilizacao = { id_externo: string; tipo_display: string; ambiente: string; status: string; status_display: string; serie: string; ano: number; numero_inicial: number; numero_final: number; mensagem_sefaz?: string; protocolo?: string; pode_baixar_xml: boolean; created_at: string };
type ConfigFiscal = { ambiente: 'homologacao' | 'producao'; serie_nfce: string; serie_nfe: string };
type FiscalAlert = { nivel: 'ERRO' | 'AVISO' | 'INFO'; codigo: string; titulo: string; descricao: string; quantidade: number };
type FiscalMonitor = { ambiente: string; certificado: { status: string; valido_ate?: string | null; dias_restantes?: number | null; mensagem: string }; resumo: { autorizadas: number; canceladas: number; rejeitadas: number; indefinidas: number; erros: number; processando_atrasadas: number; vendas_sem_documento: number }; contingencia: { suportada: boolean; motivo: string }; alertas: FiscalAlert[] };
type CartaCorrecao = { id_externo: string; documento: string; documento_numero: string; documento_serie: string; sequencia: number; texto_correcao: string; status: string; status_display: string; mensagem_sefaz?: string; protocolo?: string; pode_baixar_xml: boolean; created_at: string };
type ApiError = { detail?: string; [key: string]: unknown };

const money = (value: string | number) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const errorMessage = (error: unknown, fallback: string) => {
  if (!(error instanceof AxiosError)) return fallback;
  const data = error.response?.data as ApiError | undefined;
  if (data?.detail) return data.detail;
  const fieldError = data && Object.values(data).find((value) => Array.isArray(value));
  return Array.isArray(fieldError) && fieldError[0] ? String(fieldError[0]) : fallback;
};

export default function Fiscal() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const canManage = !user?.papel || ['ADMIN', 'GERENTE'].includes(user.papel);
  const [invalidation, setInvalidation] = useState({
    tipo: 'NFCE' as FiscalType,
    serie: '',
    ano: String(new Date().getFullYear()),
    numeroInicial: '',
    numeroFinal: '',
    justificativa: '',
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['fiscal-vendas-elegiveis'] });
    queryClient.invalidateQueries({ queryKey: ['fiscal-documentos'] });
    queryClient.invalidateQueries({ queryKey: ['fiscal-inutilizacoes'] });
    queryClient.invalidateQueries({ queryKey: ['fiscal-monitor'] });
    queryClient.invalidateQueries({ queryKey: ['fiscal-cartas-correcao'] });
  };
  const eligible = useQuery<VendaElegivel[]>({
    queryKey: ['fiscal-vendas-elegiveis'],
    queryFn: async () => { const { data } = await api.get('/fiscal/documentos/vendas-elegiveis/'); return data.results || data; },
  });
  const documents = useQuery<Documento[]>({
    queryKey: ['fiscal-documentos'],
    queryFn: async () => { const { data } = await api.get('/fiscal/documentos/'); return data.results || data; },
  });
  const config = useQuery<ConfigFiscal>({
    queryKey: ['fiscal-config-resumo'],
    enabled: canManage,
    queryFn: async () => (await api.get('/fiscal/configuracao/')).data,
  });
  const invalidations = useQuery<Inutilizacao[]>({
    queryKey: ['fiscal-inutilizacoes'],
    enabled: canManage,
    queryFn: async () => { const { data } = await api.get('/fiscal/inutilizacoes/'); return data.results || data; },
  });
  const monitor = useQuery<FiscalMonitor>({
    queryKey: ['fiscal-monitor'],
    enabled: canManage,
    queryFn: async () => (await api.get('/fiscal/monitor/')).data,
  });
  const correctionLetters = useQuery<CartaCorrecao[]>({
    queryKey: ['fiscal-cartas-correcao'],
    enabled: canManage,
    queryFn: async () => { const { data } = await api.get('/fiscal/cartas-correcao/'); return data.results || data; },
  });

  const issue = useMutation({
    mutationFn: ({ venda, tipo }: { venda: number; tipo: FiscalType }) => api.post<Documento>('/fiscal/documentos/emitir/', { venda, tipo, canal: 'PDV' }),
    onSuccess: ({ data }, variables) => {
      if (data.status === 'AUTORIZADA') toast.success(`${variables.tipo === 'NFE' ? 'NF-e' : 'NFC-e'} autorizada pela SEFAZ.`);
      else toast.error(data.mensagem_sefaz || `${data.tipo_display} retornou como ${data.status_display}.`);
      refresh();
    },
    onError: (error: unknown) => { toast.error(errorMessage(error, 'Não foi possível emitir o documento fiscal.')); refresh(); },
  });
  const cancel = useMutation({
    mutationFn: ({ id, justificativa }: { id: string; justificativa: string }) => api.post(`/fiscal/documentos/${id}/cancelar/`, { justificativa }),
    onSuccess: () => { toast.success('Documento fiscal cancelado.'); refresh(); },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Não foi possível cancelar o documento.')),
  });
  const invalidateNumbers = useMutation({
    mutationFn: (payload: { tipo: FiscalType; serie: string; ano: number; numero_inicial: number; numero_final: number; justificativa: string }) => api.post<Inutilizacao>('/fiscal/inutilizacoes/', payload),
    onSuccess: ({ data }) => {
      if (data.status === 'INUTILIZADA') {
        toast.success(`Faixa ${data.numero_inicial}-${data.numero_final} inutilizada na SEFAZ.`);
        setInvalidation((current) => ({ ...current, numeroInicial: '', numeroFinal: '', justificativa: '' }));
      } else toast.error(data.mensagem_sefaz || 'A SEFAZ não confirmou a inutilização.');
      refresh();
    },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Não foi possível inutilizar a numeração.')),
  });
  const correct = useMutation({
    mutationFn: ({ id, texto }: { id: string; texto: string }) => api.post<CartaCorrecao>(`/fiscal/documentos/${id}/carta-correcao/`, { texto_correcao: texto }),
    onSuccess: ({ data }) => {
      if (data.status === 'REGISTRADA') toast.success(`Carta de Correção nº ${data.sequencia} registrada na SEFAZ.`);
      else toast.error(data.mensagem_sefaz || 'A SEFAZ não confirmou a Carta de Correção.');
      refresh();
    },
    onError: (error: unknown) => { toast.error(errorMessage(error, 'Não foi possível registrar a Carta de Correção.')); refresh(); },
  });

  const cancelDocument = (document: Documento) => {
    const reason = window.prompt('Justificativa do cancelamento (mínimo de 15 caracteres):');
    if (reason) cancel.mutate({ id: document.id, justificativa: reason });
  };
  const correctDocument = (document: Documento) => {
    const text = window.prompt('Descreva exatamente a correção da NF-e (mínimo de 15 caracteres). Não é permitido alterar valores, impostos, remetente ou destinatário:');
    if (text) correct.mutate({ id: document.id, texto: text });
  };
  const download = async (document: Documento, format: 'xml' | 'pdf') => {
    try {
      const response = await api.get(`/fiscal/documentos/${document.id}/${format}/`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = `${document.tipo_display}-${document.numero || document.id}.${format}`;
      if (format === 'pdf') anchor.target = '_blank';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { toast.error(errorMessage(error, `Não foi possível obter o ${format.toUpperCase()}.`)); }
  };
  const submitInvalidation = () => {
    const series = invalidation.serie || (invalidation.tipo === 'NFCE' ? config.data?.serie_nfce : config.data?.serie_nfe) || '';
    if (!series || !invalidation.numeroInicial || !invalidation.numeroFinal) {
      toast.error('Preencha série, número inicial e número final.');
      return;
    }
    if (invalidation.justificativa.trim().length < 15) {
      toast.error('A justificativa deve ter no mínimo 15 caracteres.');
      return;
    }
    const environment = config.data?.ambiente || 'homologacao';
    const confirmed = window.confirm(
      `Confirma a inutilização ${environment === 'producao' ? 'REAL EM PRODUÇÃO' : 'em homologação'} da ${invalidation.tipo === 'NFCE' ? 'NFC-e' : 'NF-e'}, série ${series}, números ${invalidation.numeroInicial} até ${invalidation.numeroFinal}?\n\nA numeração inutilizada não poderá ser usada para emitir nota.`,
    );
    if (!confirmed) return;
    invalidateNumbers.mutate({
      tipo: invalidation.tipo,
      serie: series,
      ano: Number(invalidation.ano),
      numero_inicial: Number(invalidation.numeroInicial),
      numero_final: Number(invalidation.numeroFinal),
      justificativa: invalidation.justificativa.trim(),
    });
  };
  const downloadInvalidationXml = async (record: Inutilizacao) => {
    try {
      const response = await api.get(`/fiscal/inutilizacoes/${record.id_externo}/xml/`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = `inutilizacao-${record.tipo_display}-${record.serie}-${record.numero_inicial}-${record.numero_final}.xml`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { toast.error(errorMessage(error, 'Não foi possível obter o XML da inutilização.')); }
  };
  const downloadCorrectionXml = async (record: CartaCorrecao) => {
    try {
      const response = await api.get(`/fiscal/cartas-correcao/${record.id_externo}/xml/`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = `carta-correcao-${record.documento_numero}-${record.sequencia}.xml`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) { toast.error(errorMessage(error, 'Não foi possível obter o XML da Carta de Correção.')); }
  };

  const environment = config.data?.ambiente;
  return <div className="animate-in">
    <div className="page-header"><h1 className="page-title">Notas fiscais</h1><p className="page-subtitle">Emissão, reenvio, cancelamento e inutilização de NF-e e NFC-e pela Geranet.</p></div>

    {canManage && environment && <div className="card" style={{ marginBottom: 20, padding: 14, border: environment === 'producao' ? '1px solid #ef4444' : '1px solid #f59e0b' }}>
      <strong>Ambiente fiscal: {environment === 'producao' ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'}</strong>
      <small style={{ display: 'block', color: 'var(--text-muted)', marginTop: 4 }}>{environment === 'producao' ? 'As operações desta tela têm validade fiscal real.' : 'Operações de teste, sem validade fiscal.'}</small>
    </div>}

    {canManage && <div className="card" style={{ marginBottom: 20, padding: 20 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 14 }}><div><h2 style={{ margin: 0, fontSize: '1rem' }}><Activity size={18} style={{ verticalAlign: 'middle', marginRight: 7 }} />Monitor fiscal</h2><small style={{ color: 'var(--text-muted)' }}>{monitor.data?.certificado.mensagem || 'Verificando integração fiscal...'}</small></div><button className="btn btn-ghost btn-sm" onClick={refresh}><RefreshCw size={15} />Atualizar</button></header>
      {monitor.isLoading ? <div className="loading">Analisando situação fiscal...</div> : monitor.data && <><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 14 }}>{[
        ['Autorizadas', monitor.data.resumo.autorizadas],
        ['Rejeitadas', monitor.data.resumo.rejeitadas],
        ['Indefinidas', monitor.data.resumo.indefinidas],
        ['Erros', monitor.data.resumo.erros],
        ['Vendas sem nota', monitor.data.resumo.vendas_sem_documento],
      ].map(([label, value]) => <div key={String(label)} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}><small style={{ color: 'var(--text-muted)' }}>{label}</small><strong style={{ display: 'block', fontSize: '1.3rem' }}>{value}</strong></div>)}</div>
      {monitor.data.alertas.length ? <div style={{ display: 'grid', gap: 8 }}>{monitor.data.alertas.map((alert) => <div key={alert.codigo} style={{ padding: 10, borderRadius: 8, border: `1px solid ${alert.nivel === 'ERRO' ? '#ef4444' : alert.nivel === 'AVISO' ? '#f59e0b' : 'var(--border)'}` }}><strong>{alert.titulo}{alert.quantidade > 1 ? ` (${alert.quantidade})` : ''}</strong><small style={{ display: 'block', color: 'var(--text-muted)', marginTop: 3 }}>{alert.descricao}</small></div>)}</div> : <p style={{ color: 'var(--text-muted)', margin: 0 }}>Nenhum alerta fiscal encontrado.</p>}</>}
    </div>}

    <div className="card" style={{ marginBottom: 20, padding: 20 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 14 }}><div><h2 style={{ margin: 0, fontSize: '1rem' }}><ReceiptText size={18} style={{ verticalAlign: 'middle', marginRight: 7 }} />Vendas prontas para emitir</h2><small style={{ color: 'var(--text-muted)' }}>NFC-e para consumidor final; NF-e exige cliente e endereço fiscal completos.</small></div><button className="btn btn-ghost btn-sm" onClick={refresh}><RefreshCw size={15} />Atualizar</button></header>
      {eligible.isLoading ? <div className="loading">Carregando vendas...</div> : eligible.data?.length ? <div className="table-wrapper"><table className="table"><thead><tr><th>Venda</th><th>Cliente</th><th>Itens</th><th>Total</th><th /></tr></thead><tbody>{eligible.data.map((venda) => <tr key={venda.id}><td>#{venda.id}</td><td>{venda.cliente_nome || 'Consumidor final'}</td><td>{venda.itens_count}</td><td>{money(venda.total_liquido)}</td><td style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button className="btn btn-primary btn-sm" disabled={issue.isPending} onClick={() => issue.mutate({ venda: venda.id, tipo: 'NFCE' })}><FileCheck2 size={15} />NFC-e</button><button className="btn btn-ghost btn-sm" disabled={issue.isPending || !venda.cliente_nome} onClick={() => issue.mutate({ venda: venda.id, tipo: 'NFE' })}><FileText size={15} />NF-e</button></td></tr>)}</tbody></table></div> : <p style={{ color: 'var(--text-muted)', margin: 0 }}>Nenhuma venda finalizada aguardando emissão.</p>}
    </div>

    <div className="card" style={{ padding: 20, marginBottom: 20 }}><h2 style={{ margin: '0 0 14px', fontSize: '1rem' }}>Documentos recentes</h2>{documents.isLoading ? <div className="loading">Carregando documentos...</div> : documents.data?.length ? <div className="table-wrapper"><table className="table"><thead><tr><th>Venda</th><th>Documento</th><th>Status</th><th>Ambiente</th><th /></tr></thead><tbody>{documents.data.map((document) => <tr key={document.id}><td>#{document.venda_numero}</td><td>{document.tipo_display}{document.numero && <small style={{ display: 'block' }}>Nº {document.numero} · Série {document.serie}</small>}</td><td><span className={`badge ${document.status === 'AUTORIZADA' ? 'badge-green' : ['REJEITADA', 'ERRO', 'INDEFINIDO'].includes(document.status) ? 'badge-red' : 'badge-yellow'}`}>{document.status_display}</span>{document.mensagem_sefaz && <small style={{ display: 'block', color: 'var(--text-muted)' }}>{document.mensagem_sefaz}</small>}{document.status === 'AUTORIZADA' && !document.pode_cancelar && <small style={{ display: 'block', color: '#ef4444' }}>{document.motivo_cancelamento}</small>}</td><td>{document.ambiente}</td><td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>{document.status === 'REJEITADA' && <button className="btn btn-primary btn-sm" disabled={issue.isPending} onClick={() => issue.mutate({ venda: document.venda_numero, tipo: document.tipo })}><Repeat2 size={14} />Reenviar</button>}{document.pode_baixar_xml && <button className="btn btn-ghost btn-sm" onClick={() => download(document, 'xml')}><Download size={14} />XML</button>}{document.pode_baixar_pdf && <button className="btn btn-ghost btn-sm" onClick={() => download(document, 'pdf')}><Download size={14} />PDF</button>}{canManage && document.tipo === 'NFE' && document.status === 'AUTORIZADA' && <button className="btn btn-ghost btn-sm" disabled={correct.isPending} onClick={() => correctDocument(document)}><PenLine size={14} />CC-e</button>}{document.pode_cancelar && <button className="btn btn-ghost btn-sm" disabled={cancel.isPending} onClick={() => cancelDocument(document)}><XCircle size={14} />Cancelar</button>}</td></tr>)}</tbody></table></div> : <p style={{ color: 'var(--text-muted)', margin: 0 }}>Nenhum documento fiscal emitido.</p>}</div>

    {canManage && correctionLetters.data?.length ? <div className="card" style={{ padding: 20, marginBottom: 20 }}><h2 style={{ margin: '0 0 14px', fontSize: '1rem' }}>Cartas de Correção</h2><div className="table-wrapper"><table className="table"><thead><tr><th>NF-e</th><th>Sequência</th><th>Correção</th><th>Status</th><th>Protocolo</th><th /></tr></thead><tbody>{correctionLetters.data.map((record) => <tr key={record.id_externo}><td>Nº {record.documento_numero} · Série {record.documento_serie}</td><td>{record.sequencia}</td><td>{record.texto_correcao}</td><td><span className={`badge ${record.status === 'REGISTRADA' ? 'badge-green' : 'badge-red'}`}>{record.status_display}</span>{record.mensagem_sefaz && <small style={{ display: 'block', color: 'var(--text-muted)' }}>{record.mensagem_sefaz}</small>}</td><td>{record.protocolo || '—'}</td><td>{record.pode_baixar_xml && <button className="btn btn-ghost btn-sm" onClick={() => downloadCorrectionXml(record)}><Download size={14} />XML</button>}</td></tr>)}</tbody></table></div></div> : null}

    {canManage && <div className="card" style={{ padding: 20 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: '1rem' }}><Ban size={18} style={{ verticalAlign: 'middle', marginRight: 7 }} />Inutilizar numeração</h2>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>Use somente para números que não foram autorizados nem usados em outro sistema. A operação é registrada e não pode ser desfeita.</p>
      <div className="form-grid">
        <div><label className="form-label">Documento</label><select className="input" value={invalidation.tipo} onChange={(event) => setInvalidation((current) => ({ ...current, tipo: event.target.value as FiscalType, serie: '' }))}><option value="NFCE">NFC-e</option><option value="NFE">NF-e</option></select></div>
        <div><label className="form-label">Série</label><input className="input" inputMode="numeric" value={invalidation.serie || (invalidation.tipo === 'NFCE' ? config.data?.serie_nfce : config.data?.serie_nfe) || ''} onChange={(event) => setInvalidation((current) => ({ ...current, serie: event.target.value }))} /></div>
        <div><label className="form-label">Ano</label><input className="input" type="number" value={invalidation.ano} onChange={(event) => setInvalidation((current) => ({ ...current, ano: event.target.value }))} /></div>
        <div><label className="form-label">Número inicial</label><input className="input" type="number" min="1" value={invalidation.numeroInicial} onChange={(event) => setInvalidation((current) => ({ ...current, numeroInicial: event.target.value }))} /></div>
        <div><label className="form-label">Número final</label><input className="input" type="number" min="1" value={invalidation.numeroFinal} onChange={(event) => setInvalidation((current) => ({ ...current, numeroFinal: event.target.value }))} /></div>
        <div style={{ gridColumn: '1 / -1' }}><label className="form-label">Justificativa (mínimo de 15 caracteres)</label><textarea className="input" rows={2} maxLength={255} value={invalidation.justificativa} onChange={(event) => setInvalidation((current) => ({ ...current, justificativa: event.target.value }))} /></div>
      </div>
      <div className="modal-actions" style={{ marginTop: 14 }}><button className="btn btn-danger" disabled={invalidateNumbers.isPending || config.isLoading} onClick={submitInvalidation}><Ban size={15} />{invalidateNumbers.isPending ? 'Inutilizando...' : 'Inutilizar na SEFAZ'}</button></div>

      <h3 style={{ fontSize: '0.95rem', margin: '24px 0 10px' }}>Histórico de inutilizações</h3>
      {invalidations.isLoading ? <div className="loading">Carregando histórico...</div> : invalidations.data?.length ? <div className="table-wrapper"><table className="table"><thead><tr><th>Documento</th><th>Faixa</th><th>Ambiente</th><th>Status</th><th>Protocolo</th><th /></tr></thead><tbody>{invalidations.data.map((record) => <tr key={record.id_externo}><td>{record.tipo_display} · Série {record.serie}/{record.ano}</td><td>{record.numero_inicial} até {record.numero_final}</td><td>{record.ambiente}</td><td><span className={`badge ${record.status === 'INUTILIZADA' ? 'badge-green' : 'badge-red'}`}>{record.status_display}</span>{record.mensagem_sefaz && <small style={{ display: 'block', color: 'var(--text-muted)' }}>{record.mensagem_sefaz}</small>}</td><td>{record.protocolo || '—'}</td><td>{record.pode_baixar_xml && <button className="btn btn-ghost btn-sm" onClick={() => downloadInvalidationXml(record)}><Download size={14} />XML</button>}</td></tr>)}</tbody></table></div> : <p style={{ color: 'var(--text-muted)', margin: 0 }}>Nenhuma inutilização registrada.</p>}
    </div>}
  </div>;
}
