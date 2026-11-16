import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { Link } from 'react-router-dom';
import { Mail, LoaderCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import Modal from '../../components/Modal';

type ConfigEnvio = { email_contador: string; email_remetente: string; ambiente: string; resend_configurado: boolean };
type ResultadoEnvio = { email: string; quantidade: number; arquivo: string; resend_id: string };

function periodoInicial() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  const month = `${part('year')}-${part('month')}`;
  return { data_inicio: `${month}-01`, data_fim: `${month}-${part('day')}` };
}

export default function EnviarXmlContadorModal({ config, onClose }: { config: ConfigEnvio; onClose: () => void }) {
  const [email, setEmail] = useState(config.email_contador || '');
  const [periodo, setPeriodo] = useState(periodoInicial);
  const [error, setError] = useState('');
  const invalidPeriod = !!periodo.data_inicio && !!periodo.data_fim && periodo.data_inicio > periodo.data_fim;
  const send = useMutation({
    mutationFn: async () => (await api.post<ResultadoEnvio>('/fiscal/documentos/enviar-xml-contador/', { email: email.trim(), ...periodo })).data,
    onSuccess: result => { toast.success(`Envio do ZIP com ${result.quantidade} XML(s) aceito para ${result.email}.`); onClose(); },
    onError: (cause: unknown) => {
      const data = cause instanceof AxiosError ? cause.response?.data as Record<string, unknown> | undefined : undefined;
      const fields = data && Object.values(data).find(value => Array.isArray(value));
      setError(typeof data?.detail === 'string' ? data.detail : Array.isArray(fields) ? fields.join(' ') : 'Não foi possível confirmar o envio. Tente novamente.');
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (send.isPending || !config.resend_configurado || invalidPeriod) return;
    setError(''); send.mutate();
  };
  return <Modal onClose={onClose} labelledBy="send-xml-title" describedBy="send-xml-description" isBusy={send.isPending} panelClassName="card animate-in modal-panel modal-panel-md">
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
      <h2 id="send-xml-title" style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center', fontSize: '1.15rem' }}><Mail size={21} />Enviar XMLs ao contador</h2>
      <button className="btn btn-ghost btn-icon" aria-label="Fechar envio de XMLs" disabled={send.isPending} onClick={onClose}><X size={20} /></button>
    </header>
    <p id="send-xml-description" style={{ color: 'var(--text-muted)', fontSize: '.88rem', lineHeight: 1.5 }}>As NF-e e NFC-e autorizadas ou canceladas no período de emissão serão compactadas em um arquivo ZIP e enviadas por e-mail.</p>
    <form onSubmit={submit}>
      <fieldset disabled={send.isPending} style={{ border: 0, padding: 0, margin: '18px 0' }}>
        <label className="form-label" htmlFor="xml-accountant-email">E-mail do contador</label>
        <input id="xml-accountant-email" className="input" type="email" value={email} required onChange={event => setEmail(event.target.value)} />
        <p className="form-hint">Você pode editar o destinatário apenas para este envio. O e-mail padrão fica em <Link to="/fiscal/configuracao">Configuração fiscal</Link>.</p>
        <div className="form-grid-2" style={{ marginTop: 16 }}>
          <div><label className="form-label" htmlFor="xml-start-date">Data inicial</label><input id="xml-start-date" className="input" type="date" required value={periodo.data_inicio} onChange={event => setPeriodo(current => ({ ...current, data_inicio: event.target.value }))} /></div>
          <div><label className="form-label" htmlFor="xml-end-date">Data final</label><input id="xml-end-date" className="input" type="date" required value={periodo.data_fim} min={periodo.data_inicio || undefined} onChange={event => setPeriodo(current => ({ ...current, data_fim: event.target.value }))} /></div>
        </div>
        <p className="form-hint" style={{ marginTop: 14 }}>Remetente: {config.email_remetente}. Ambiente: {config.ambiente === 'producao' ? 'Produção' : 'Homologação'}. O período inclui todas as notas elegíveis, independentemente dos filtros da lista.</p>
      </fieldset>
      {!config.resend_configurado && <p role="alert">O Resend ainda não está configurado no servidor. <Link to="/fiscal/configuracao">Consultar configurações fiscais</Link>.</p>}
      {invalidPeriod && <p role="alert">A data final deve ser igual ou posterior à data inicial.</p>}
      {error && <p role="alert" style={{ color: 'var(--accent-red)' }}>{error}</p>}
      <div className="modal-actions">
        <button className="btn btn-ghost" type="button" disabled={send.isPending} onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" type="submit" disabled={send.isPending || !config.resend_configurado || invalidPeriod}>{send.isPending ? <><LoaderCircle size={16} className="button-spinner" />Compactando e enviando...</> : <><Mail size={16} />Enviar ZIP por e-mail</>}</button>
      </div>
    </form>
  </Modal>;
}
