import { FormEvent, useEffect, useState } from 'react';
import { Save, ShieldCheck, BadgeCheck } from 'lucide-react';
import { toast } from 'sonner';
import { AxiosError } from 'axios';
import api from '../../lib/api';

type Config = {
  ambiente: string; api_url: string; api_key_configurada: boolean;
  certificado_nome: string; certificado_configurado: boolean; certificado_senha_configurada: boolean;
  cnpj: string; inscricao_estadual: string; razao_social: string; nome_fantasia: string;
  telefone: string; email: string; logradouro: string; numero: string; complemento: string;
  bairro: string; municipio: string; codigo_municipio: string; uf: string; cep: string;
  codigo_regime_tributario: string; tipo_atividade: string; serie_nfce: string;
  proximo_numero_nfce: number; serie_nfe: string; proximo_numero_nfe: number;
  csc_id: string; csc_configurado: boolean;
};

const initial: Config = {
  ambiente: 'homologacao', api_url: 'https://nfe.geranet.net/api/v1', api_key_configurada: false,
  certificado_nome: '', certificado_configurado: false, certificado_senha_configurada: false,
  cnpj: '', inscricao_estadual: '', razao_social: '', nome_fantasia: '', telefone: '', email: '',
  logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', codigo_municipio: '',
  uf: '', cep: '', codigo_regime_tributario: '1', tipo_atividade: '3', serie_nfce: '1',
  proximo_numero_nfce: 1, serie_nfe: '1', proximo_numero_nfe: 1, csc_id: '', csc_configurado: false,
};

export default function ConfiguracaoFiscal() {
  const [form, setForm] = useState(initial);
  const [apiKey, setApiKey] = useState('');
  const [senha, setSenha] = useState('');
  const [csc, setCsc] = useState('');
  const [certificado, setCertificado] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);

  useEffect(() => {
    api.get<Config>('/fiscal/configuracao/').then(({ data }) => setForm({ ...initial, ...data }))
      .catch(() => toast.error('Não foi possível carregar a configuração fiscal.')).finally(() => setLoading(false));
  }, []);

  const set = (field: keyof Config, value: string) => setForm(current => ({
    ...current, [field]: field.startsWith('proximo_numero_') ? Number(value) : value,
  }));

  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    const data = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (!key.endsWith('_configurada') && key !== 'certificado_nome') data.append(key, String(value ?? ''));
    });
    if (apiKey) data.append('api_key', apiKey);
    if (senha) data.append('certificado_senha', senha);
    if (csc) data.append('csc', csc);
    if (certificado) data.append('certificado', certificado);
    try {
      const response = await api.patch<Config>('/fiscal/configuracao/', data);
      setForm({ ...initial, ...response.data }); setApiKey(''); setSenha(''); setCsc(''); setCertificado(null);
      toast.success('Configuração fiscal salva com segurança.');
    } catch { toast.error('Confira os campos fiscais e tente novamente.'); }
    finally { setSaving(false); }
  };

  const validate = async () => {
    setValidating(true);
    try {
      const { data } = await api.post<{ valido: boolean; valido_ate: string }>('/fiscal/configuracao/validar/');
      toast.success(`Configuração válida. Certificado até ${new Date(data.valido_ate).toLocaleDateString('pt-BR')}.`);
    } catch (error) {
      const detail = error instanceof AxiosError
        ? (error.response?.data as { detail?: string })?.detail
        : undefined;
      toast.error(detail || 'A configuração ou o certificado A1 ainda não estão válidos.');
    }
    finally { setValidating(false); }
  };

  if (loading) return <div className="page-container">Carregando configuração fiscal...</div>;
  const field = (label: string, key: keyof Config, extra = {}) => <div><label className="form-label">{label}</label><input className="input" value={String(form[key] ?? '')} onChange={e => set(key, e.target.value)} {...extra} /></div>;

  return <div className="page-container animate-in">
    <div className="page-header"><div><h1 style={{display:'flex',gap:10,alignItems:'center'}}><ShieldCheck size={26}/> Configuração Fiscal</h1><p>Geranet, certificado A1 e dados do emitente.</p></div></div>
    <form className="card" onSubmit={save} style={{padding:24}}>
      <h2>Integração Geranet</h2><p className="form-hint">Segredos e certificado são criptografados. Os valores salvos nunca voltam para o navegador.</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:16,marginTop:18}}>
        <div><label className="form-label">Ambiente</label><select className="input" value={form.ambiente} onChange={e=>set('ambiente',e.target.value)}><option value="homologacao">Homologação</option><option value="producao">Produção</option></select></div>
        {field('URL da API','api_url')}
        <div><label className="form-label">Chave da API</label><input className="input" type="password" placeholder={form.api_key_configurada?'Já configurada — deixe vazio para manter':'Cole a chave Geranet'} value={apiKey} onChange={e=>setApiKey(e.target.value)}/></div>
        <div><label className="form-label">Certificado A1</label><input className="input" type="file" accept=".pfx,.p12" onChange={e=>setCertificado(e.target.files?.[0]||null)}/><small>{form.certificado_nome||'Nenhum certificado salvo'}</small></div>
        <div><label className="form-label">Senha do certificado</label><input className="input" type="password" placeholder={form.certificado_senha_configurada?'Já configurada — deixe vazio para manter':'Senha do A1'} value={senha} onChange={e=>setSenha(e.target.value)}/></div>
      </div>
      <h2 style={{marginTop:28}}>Empresa emitente</h2>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:16,marginTop:16}}>
        {field('CNPJ','cnpj',{inputMode:'numeric'})}{field('Inscrição Estadual','inscricao_estadual')}{field('Razão social','razao_social')}{field('Nome fantasia','nome_fantasia')}
        {field('Telefone','telefone')}{field('E-mail','email',{type:'email'})}{field('Logradouro','logradouro')}{field('Número','numero')}
        {field('Complemento','complemento')}{field('Bairro','bairro')}{field('Município','municipio')}{field('Código IBGE','codigo_municipio')}
        {field('UF','uf',{maxLength:2})}{field('CEP','cep')}
        <div><label className="form-label">Regime tributário</label><select className="input" value={form.codigo_regime_tributario} onChange={e=>set('codigo_regime_tributario',e.target.value)}><option value="1">Simples Nacional</option><option value="2">Simples — excesso</option><option value="3">Regime normal</option><option value="4">MEI</option></select></div>
        <div><label className="form-label">Tipo de atividade</label><select className="input" value={form.tipo_atividade} onChange={e=>set('tipo_atividade',e.target.value)}><option value="1">Comércio</option><option value="3">Comércio e serviço</option><option value="4">Indústria e comércio</option><option value="5">Indústria, comércio e serviço</option></select></div>
      </div>
      <h2 style={{marginTop:28}}>Numeração e NFC-e</h2>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:16,marginTop:16}}>
        {field('Série NFC-e','serie_nfce')}{field('Próximo número NFC-e','proximo_numero_nfce',{type:'number',min:1})}{field('Série NF-e','serie_nfe')}{field('Próximo número NF-e','proximo_numero_nfe',{type:'number',min:1})}
        {field('ID do CSC','csc_id')}<div><label className="form-label">CSC</label><input className="input" type="password" placeholder={form.csc_configurado?'Já configurado — deixe vazio para manter':'Token CSC'} value={csc} onChange={e=>setCsc(e.target.value)}/></div>
      </div>
      <div className="modal-actions" style={{marginTop:24}}><button type="button" className="btn btn-ghost" disabled={validating} onClick={validate}><BadgeCheck size={16}/>{validating?'Validando...':'Validar configuração'}</button><button className="btn btn-primary" disabled={saving}><Save size={16}/>{saving?'Salvando...':'Salvar configuração fiscal'}</button></div>
    </form>
  </div>;
}
