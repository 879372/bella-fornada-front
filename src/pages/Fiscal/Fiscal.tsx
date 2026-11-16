import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { Activity, AlertTriangle, Ban, Download, PenLine, RefreshCw, Repeat2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import ConfirmModal from '../../components/ConfirmModal';
import TotalsCards, { type Totals } from '../../components/TotalsCards';
import { useAuthStore } from '../../store/authStore';

type FiscalType = 'NFCE' | 'NFE';
type Documento = { id: string; venda_numero: number; tipo: FiscalType; tipo_display: string; status: string; status_display: string; ambiente: string; codigo_status?: string; mensagem_sefaz?: string; numero?: string; serie?: string; chave_acesso?: string; pode_baixar_xml: boolean; pode_baixar_pdf: boolean; pode_cancelar: boolean; pode_inutilizar: boolean; prazo_cancelamento_em?: string | null; motivo_cancelamento?: string; motivo_inutilizacao?: string; created_at: string };
type Inutilizacao = { id_externo: string; tipo_display: string; ambiente: string; status: string; status_display: string; serie: string; ano: number; numero_inicial: number; numero_final: number; mensagem_sefaz?: string; protocolo?: string; pode_baixar_xml: boolean; created_at: string };
type ConfigFiscal = { ambiente: 'homologacao' | 'producao'; serie_nfce: string; serie_nfe: string };
type FiscalAlert = { nivel: 'ERRO' | 'AVISO' | 'INFO'; codigo: string; titulo: string; descricao: string; quantidade: number };
type FiscalMonitor = { ambiente: string; certificado: { status: string; valido_ate?: string | null; dias_restantes?: number | null; mensagem: string }; resumo: { autorizadas: number; canceladas: number; rejeitadas: number; indefinidas: number; erros: number; processando_atrasadas: number; vendas_sem_documento: number }; contingencia: { suportada: boolean; motivo: string }; alertas: FiscalAlert[] };
type CartaCorrecao = { id_externo: string; documento: string; documento_numero: string; documento_serie: string; sequencia: number; texto_correcao: string; status: string; status_display: string; mensagem_sefaz?: string; protocolo?: string; pode_baixar_xml: boolean; created_at: string };
type ApiError = { detail?: string; [key: string]: unknown };
type Paginated<T> = { count: number; next?: string | null; previous?: string | null; results: T[] };

type InvalidationPayload = { tipo: FiscalType; serie: string; ano: number; numero_inicial: number; numero_final: number; justificativa: string };
type FiscalAction = { kind: 'cancel' | 'correct' | 'resolve'; document: Documento } | { kind: 'invalidate'; payload: InvalidationPayload };

const PAGE_SIZE = 50;
const normalizePage = <T,>(data: Paginated<T> | T[]): Paginated<T> => (
  Array.isArray(data)
    ? { count: data.length, next: null, previous: null, results: data }
    : data
);

const errorMessage = (error: unknown, fallback: string) => {
  if (!(error instanceof AxiosError)) return fallback;
  const data = error.response?.data as ApiError | undefined;
  if (data?.detail) return data.detail;
  const fieldError = data && Object.values(data).find((value) => Array.isArray(value));
  return Array.isArray(fieldError) && fieldError[0] ? String(fieldError[0]) : fallback;
};

const rejectionResolution = (document: Documento) => {
  const message = (document.mensagem_sefaz || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (document.codigo_status === '391' || message.includes('dados do cartao')) {
    return {
      label: 'Corrigir e reenviar',
      guidance: 'O pagamento eletrônico será reenviado como terminal não integrado ao PDV.',
      confirmation: 'O sistema incluirá os dados fiscais do pagamento eletrônico e reenviará o mesmo número do documento.',
    };
  }
  if (message.includes('connection timed out') || message.includes('erro http: 0') || message.includes('tempo limite') || message.includes('timeout')) {
    return {
      label: 'Reprocessar',
      guidance: 'Falha de comunicação com a SEFAZ. O reprocessamento preserva número, série e referência.',
      confirmation: 'Houve falha de comunicação. Confirma o reprocessamento usando o mesmo número, série e referência fiscal?',
    };
  }
  return {
    label: 'Resolver e reenviar',
    guidance: 'Confira o motivo retornado pela SEFAZ antes de tentar novamente.',
    confirmation: 'Confirma o reenvio do mesmo documento após conferir o motivo da rejeição?',
  };
};

function FiscalPagination({ page, count, onChange }: { page: number; count: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  if (pages <= 1) return null;
  return <div className="pagination-bar">
    <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Anterior</button>
    <span>Página {page} de {pages} · {count} registros</span>
    <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>Próxima</button>
  </div>;
}

export default function Fiscal() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const canManage = !user?.papel || ['ADMIN', 'GERENTE'].includes(user.papel);
  const [documentsPage, setDocumentsPage] = useState(1);
  const [action, setAction] = useState<FiscalAction | null>(null);
  const [reason, setReason] = useState('');
  const openAction = (next: FiscalAction) => { setReason(''); setAction(next); };
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
    queryClient.invalidateQueries({ queryKey: ['fiscal-totalizadores'] });
    queryClient.invalidateQueries({ queryKey: ['vendas'] });
    queryClient.invalidateQueries({ queryKey: ['fiscal-cartas-correcao'] });
  };
  const documents = useQuery<Paginated<Documento>>({
    queryKey: ['fiscal-documentos', documentsPage],
    queryFn: async () => {
      const { data } = await api.get<Paginated<Documento> | Documento[]>('/fiscal/documentos/', { params: { page: documentsPage } });
      return normalizePage(data);
    },
  });
  const totals = useQuery<{ ambiente: string; transmitidas: Totals; pendentes: Totals }>({
    queryKey: ['fiscal-totalizadores'],
    queryFn: async () => (await api.get('/fiscal/documentos/totalizadores/')).data,
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
      else if (data.status === 'INDEFINIDO') toast.warning(data.mensagem_sefaz || 'A comunicação terminou sem confirmação. Reprocesse o mesmo documento.');
      else toast.error(data.mensagem_sefaz || `${data.tipo_display} retornou como ${data.status_display}.`);
      setAction(null);
      refresh();
    },
    onError: (error: unknown) => { toast.error(errorMessage(error, 'Não foi possível emitir o documento fiscal.')); refresh(); },
  });
  const cancel = useMutation({
    mutationFn: ({ id, justificativa }: { id: string; justificativa: string }) => api.post(`/fiscal/documentos/${id}/cancelar/`, { justificativa }),
    onSuccess: () => { toast.success('Documento fiscal cancelado.'); setAction(null); refresh(); },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Não foi possível cancelar o documento.')),
  });
  const invalidateNumbers = useMutation({
    mutationFn: (payload: { tipo: FiscalType; serie: string; ano: number; numero_inicial: number; numero_final: number; justificativa: string }) => api.post<Inutilizacao>('/fiscal/inutilizacoes/', payload),
    onSuccess: ({ data }) => {
      if (data.status === 'INUTILIZADA') {
        toast.success(`Faixa ${data.numero_inicial}-${data.numero_final} inutilizada na SEFAZ.`);
        setInvalidation((current) => ({ ...current, numeroInicial: '', numeroFinal: '', justificativa: '' }));
      } else toast.error(data.mensagem_sefaz || 'A SEFAZ não confirmou a inutilização.');
      setAction(null);
      refresh();
    },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Não foi possível inutilizar a numeração.')),
  });
  const correct = useMutation({
    mutationFn: ({ id, texto }: { id: string; texto: string }) => api.post<CartaCorrecao>(`/fiscal/documentos/${id}/carta-correcao/`, { texto_correcao: texto }),
    onSuccess: ({ data }) => {
      if (data.status === 'REGISTRADA') toast.success(`Carta de Correção nº ${data.sequencia} registrada na SEFAZ.`);
      else toast.error(data.mensagem_sefaz || 'A SEFAZ não confirmou a Carta de Correção.');
      setAction(null);
      refresh();
    },
    onError: (error: unknown) => { toast.error(errorMessage(error, 'Não foi possível registrar a Carta de Correção.')); refresh(); },
  });

  const cancelDocument = (document: Documento) => openAction({ kind: 'cancel', document });
  const correctDocument = (document: Documento) => openAction({ kind: 'correct', document });
  const resolveDocument = (document: Documento) => openAction({ kind: 'resolve', document });
  const prepareInvalidation = (document: Documento) => {
    if (document.ambiente !== config.data?.ambiente) {
      toast.error('Altere a configuração para o ambiente original do documento antes de inutilizar a numeração.');
      return;
    }
    if (!document.pode_inutilizar || !document.numero || !document.serie) {
      toast.error(document.motivo_inutilizacao || 'Esta numeração não pode ser inutilizada.');
      return;
    }
    openAction({ kind: 'invalidate', payload: {
      tipo: document.tipo, serie: document.serie,
      ano: new Date(document.created_at).getFullYear(),
      numero_inicial: Number(document.numero), numero_final: Number(document.numero),
      justificativa: 'Numeração rejeitada sem autorização de uso pela SEFAZ.',
    } });
    setReason('Numeração rejeitada sem autorização de uso pela SEFAZ.');
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
    const first = Number(invalidation.numeroInicial);
    const last = Number(invalidation.numeroFinal);
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || !/^\d{4}$/.test(invalidation.ano)) {
      toast.error('Informe um ano válido e uma faixa de números inteiros em ordem crescente.');
      return;
    }
    openAction({ kind: 'invalidate', payload: {
      tipo: invalidation.tipo, serie: series, ano: Number(invalidation.ano),
      numero_inicial: first, numero_final: last, justificativa: invalidation.justificativa.trim(),
    } });
    setReason(invalidation.justificativa.trim());
  };
  const actionBusy = issue.isPending || cancel.isPending || correct.isPending || invalidateNumbers.isPending;
  const needsReason = action?.kind === 'cancel' || action?.kind === 'correct' || action?.kind === 'invalidate';
  const confirmAction = () => {
    if (!action || actionBusy || (needsReason && reason.trim().length < 15)) return;
    if (action.kind === 'cancel') cancel.mutate({ id: action.document.id, justificativa: reason.trim() });
    if (action.kind === 'correct') correct.mutate({ id: action.document.id, texto: reason.trim() });
    if (action.kind === 'resolve') issue.mutate({ venda: action.document.venda_numero, tipo: action.document.tipo });
    if (action.kind === 'invalidate') invalidateNumbers.mutate({ ...action.payload, justificativa: reason.trim() });
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

    <TotalsCards loading={totals.isLoading} error={totals.isError} items={[
      { label: 'Transmitidas · autorizadas', totals: totals.data?.transmitidas },
      { label: 'Pendentes de autorização', totals: totals.data?.pendentes },
    ]} />
    <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Ambiente: {totals.data?.ambiente || '—'}. Pendentes incluem vendas finalizadas com itens, sem nota autorizada ou cancelada, inclusive sem emissão. Valores líquidos de desconto.</p>

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

    <div className="card" style={{ padding: 20, marginBottom: 20 }}>
      <h2 style={{ margin: '0 0 14px', fontSize: '1rem' }}>Documentos recentes</h2>
      {documents.isLoading ? <div className="loading">Carregando documentos...</div> : documents.data?.results.length ? <>
        <div className="table-wrapper"><table className="table"><thead><tr><th>Venda</th><th>Documento</th><th>Status</th><th>Ambiente</th><th /></tr></thead><tbody>{documents.data.results.map((document) => {
          const resolution = rejectionResolution(document);
          return <tr key={document.id}>
            <td>#{document.venda_numero}</td>
            <td>{document.tipo_display}{document.numero && <small style={{ display: 'block' }}>Nº {document.numero} · Série {document.serie}</small>}</td>
            <td>
              <span className={`badge ${document.status === 'AUTORIZADA' ? 'badge-green' : document.status === 'INDEFINIDO' ? 'badge-yellow' : ['REJEITADA', 'ERRO'].includes(document.status) ? 'badge-red' : 'badge-yellow'}`}>{document.status_display}</span>
              {document.mensagem_sefaz && <small style={{ display: 'block', color: 'var(--text-muted)', maxWidth: 640 }}>{document.mensagem_sefaz}</small>}
              {['REJEITADA', 'INDEFINIDO'].includes(document.status) && <small style={{ display: 'flex', gap: 5, alignItems: 'center', color: 'var(--accent-yellow)', marginTop: 5 }}><AlertTriangle size={13} />{resolution.guidance}</small>}
              {document.status === 'AUTORIZADA' && !document.pode_cancelar && <small style={{ display: 'block', color: '#ef4444' }}>{document.motivo_cancelamento}</small>}
            </td>
            <td>{document.ambiente}</td>
            <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {['REJEITADA', 'INDEFINIDO'].includes(document.status) && <button className="btn btn-primary btn-sm" disabled={issue.isPending} onClick={() => resolveDocument(document)}><Repeat2 size={14} />{resolution.label}</button>}
              {canManage && document.pode_inutilizar && <button className="btn btn-danger btn-sm" disabled={actionBusy || !config.data} onClick={() => prepareInvalidation(document)} title={document.motivo_inutilizacao}><Ban size={14} />Inutilizar</button>}
              {document.pode_baixar_xml && <button className="btn btn-ghost btn-sm" onClick={() => download(document, 'xml')}><Download size={14} />XML</button>}
              {document.pode_baixar_pdf && <button className="btn btn-ghost btn-sm" onClick={() => download(document, 'pdf')}><Download size={14} />PDF</button>}
              {canManage && document.tipo === 'NFE' && document.status === 'AUTORIZADA' && <button className="btn btn-ghost btn-sm" disabled={correct.isPending} onClick={() => correctDocument(document)}><PenLine size={14} />CC-e</button>}
              {document.pode_cancelar && <button className="btn btn-ghost btn-sm" disabled={cancel.isPending} onClick={() => cancelDocument(document)}><XCircle size={14} />Cancelar</button>}
            </td>
          </tr>;
        })}</tbody></table></div>
        <FiscalPagination page={documentsPage} count={documents.data.count} onChange={setDocumentsPage} />
      </> : <p style={{ color: 'var(--text-muted)', margin: 0 }}>Nenhum documento fiscal emitido.</p>}
    </div>

    {canManage && correctionLetters.data?.length ? <div className="card" style={{ padding: 20, marginBottom: 20 }}><h2 style={{ margin: '0 0 14px', fontSize: '1rem' }}>Cartas de Correção</h2><div className="table-wrapper"><table className="table"><thead><tr><th>NF-e</th><th>Sequência</th><th>Correção</th><th>Status</th><th>Protocolo</th><th /></tr></thead><tbody>{correctionLetters.data.map((record) => <tr key={record.id_externo}><td>Nº {record.documento_numero} · Série {record.documento_serie}</td><td>{record.sequencia}</td><td>{record.texto_correcao}</td><td><span className={`badge ${record.status === 'REGISTRADA' ? 'badge-green' : 'badge-red'}`}>{record.status_display}</span>{record.mensagem_sefaz && <small style={{ display: 'block', color: 'var(--text-muted)' }}>{record.mensagem_sefaz}</small>}</td><td>{record.protocolo || '—'}</td><td>{record.pode_baixar_xml && <button className="btn btn-ghost btn-sm" onClick={() => downloadCorrectionXml(record)}><Download size={14} />XML</button>}</td></tr>)}</tbody></table></div></div> : null}

    {canManage && <div id="fiscal-invalidation" className="card" style={{ padding: 20, scrollMarginTop: 20 }}>
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
      <div className="modal-actions" style={{ marginTop: 14 }}><button className="btn btn-danger" disabled={actionBusy || !config.data} onClick={submitInvalidation}><Ban size={15} />{invalidateNumbers.isPending ? 'Inutilizando...' : 'Inutilizar na SEFAZ'}</button></div>

      <h3 style={{ fontSize: '0.95rem', margin: '24px 0 10px' }}>Histórico de inutilizações</h3>
      {invalidations.isLoading ? <div className="loading">Carregando histórico...</div> : invalidations.data?.length ? <div className="table-wrapper"><table className="table"><thead><tr><th>Documento</th><th>Faixa</th><th>Ambiente</th><th>Status</th><th>Protocolo</th><th /></tr></thead><tbody>{invalidations.data.map((record) => <tr key={record.id_externo}><td>{record.tipo_display} · Série {record.serie}/{record.ano}</td><td>{record.numero_inicial} até {record.numero_final}</td><td>{record.ambiente}</td><td><span className={`badge ${record.status === 'INUTILIZADA' ? 'badge-green' : 'badge-red'}`}>{record.status_display}</span>{record.mensagem_sefaz && <small style={{ display: 'block', color: 'var(--text-muted)' }}>{record.mensagem_sefaz}</small>}</td><td>{record.protocolo || '—'}</td><td>{record.pode_baixar_xml && <button className="btn btn-ghost btn-sm" onClick={() => downloadInvalidationXml(record)}><Download size={14} />XML</button>}</td></tr>)}</tbody></table></div> : <p style={{ color: 'var(--text-muted)', margin: 0 }}>Nenhuma inutilização registrada.</p>}
    </div>}
    <ConfirmModal isOpen={!!action}
      title={action?.kind === 'invalidate' ? 'Confirmar inutilização' : action?.kind === 'cancel' ? 'Cancelar nota fiscal' : action?.kind === 'correct' ? 'Registrar Carta de Correção' : 'Confirmar reenvio'}
      description={action?.kind === 'invalidate'
        ? `Inutilizar ${action.payload.tipo === 'NFCE' ? 'NFC-e' : 'NF-e'}, série ${action.payload.serie}, ano ${action.payload.ano}, números ${action.payload.numero_inicial} até ${action.payload.numero_final}? A numeração inutilizada não poderá ser usada para emitir nota.`
        : action ? `${action.document.tipo_display} nº ${action.document.numero || '—'}, série ${action.document.serie || '—'}. ${action.kind === 'resolve' ? rejectionResolution(action.document).confirmation : action.kind === 'correct' ? 'Descreva a correção. Não é permitido alterar valores, impostos, remetente ou destinatário.' : 'Confirma o cancelamento deste documento na SEFAZ?'}` : ''}
      confirmLabel={action?.kind === 'invalidate' ? 'Confirmar inutilização' : action?.kind === 'cancel' ? 'Cancelar nota' : action?.kind === 'correct' ? 'Registrar correção' : 'Reenviar documento'}
      isDanger={action?.kind === 'invalidate' || action?.kind === 'cancel'}
      isLoading={actionBusy} confirmDisabled={!!needsReason && reason.trim().length < 15}
      onClose={() => setAction(null)} onConfirm={confirmAction}>
      <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>Ambiente fiscal: <strong>{(action && 'document' in action ? action.document.ambiente : environment) === 'producao' ? 'PRODUÇÃO — operação com validade fiscal real' : 'HOMOLOGAÇÃO — operação de teste'}</strong></p>
      {needsReason && <div style={{ textAlign: 'left', marginBottom: 20 }}>
        <label className="form-label" htmlFor="fiscal-action-reason">{action?.kind === 'correct' ? 'Correção' : 'Justificativa'} (mínimo de 15 caracteres)</label>
        <textarea id="fiscal-action-reason" className="input" rows={4} maxLength={action?.kind === 'correct' ? 1000 : 255} value={reason} disabled={actionBusy} onChange={event => setReason(event.target.value)} />
      </div>}
    </ConfirmModal>
  </div>;
}
