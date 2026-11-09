import { FormEvent, useEffect, useState } from 'react';
import { Download, Save, Scale } from 'lucide-react';
import { toast } from 'sonner';

import api from '../../lib/api';

interface ConfiguracaoBalanca {
  nome: string;
  fabricante: string;
  modelo: string;
  versao_mgv: string;
  ip: string;
  porta: number;
  departamento: number;
  validade_padrao_dias: number;
  prefixo_ean: string;
}

const inicial: ConfiguracaoBalanca = {
  nome: 'Balança principal',
  fabricante: 'Toledo',
  modelo: '',
  versao_mgv: '',
  ip: '',
  porta: 0,
  departamento: 1,
  validade_padrao_dias: 1,
  prefixo_ean: '2',
};

export default function Balancas() {
  const [configuracao, setConfiguracao] = useState(inicial);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    api.get<ConfiguracaoBalanca>('/balancas/configuracao/')
      .then(({ data }) => setConfiguracao({ ...inicial, ...data, ip: data.ip || '' }))
      .catch(() => toast.error('Não foi possível carregar a configuração da balança.'))
      .finally(() => setCarregando(false));
  }, []);

  const alterar = (campo: keyof ConfiguracaoBalanca, valor: string) => {
    const numericos = new Set<keyof ConfiguracaoBalanca>([
      'porta', 'departamento', 'validade_padrao_dias',
    ]);
    setConfiguracao((atual) => ({
      ...atual,
      [campo]: numericos.has(campo) ? Number(valor) : valor,
    }));
  };

  const salvar = async (event: FormEvent) => {
    event.preventDefault();
    setSalvando(true);
    try {
      const { data } = await api.patch<ConfiguracaoBalanca>(
        '/balancas/configuracao/', configuracao,
      );
      setConfiguracao({ ...inicial, ...data, ip: data.ip || '' });
      toast.success('Configuração da balança salva.');
    } catch {
      toast.error('Confira o IP, a porta e os demais campos.');
    } finally {
      setSalvando(false);
    }
  };

  const exportar = async () => {
    setExportando(true);
    try {
      const { data } = await api.get('/balancas/exportar/', { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'carga_balanca.csv';
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Carga gerada com os produtos ativos vendidos por KG.');
    } catch {
      toast.error('Não foi possível gerar a carga da balança.');
    } finally {
      setExportando(false);
    }
  };

  if (carregando) return <div className="page-container">Carregando configuração...</div>;

  return (
    <div className="page-container animate-in">
      <div className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Scale size={26} /> Balanças
          </h1>
          <p>Configure a Prix e gere a carga de produtos pesáveis para o MGV.</p>
        </div>
      </div>

      <form className="card" onSubmit={salvar} style={{ padding: 24 }}>
        <h2 style={{ marginBottom: 6 }}>Configuração da balança</h2>
        <p className="form-hint" style={{ marginBottom: 20 }}>
          O IP fica registrado no sistema. A comunicação com a rede local é feita pelo MGV
          instalado no computador da loja.
        </p>
        <div className="form-grid-12" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
          <div style={{ gridColumn: 'span 6' }}><label className="form-label">Nome</label><input className="input" value={configuracao.nome} onChange={(e) => alterar('nome', e.target.value)} /></div>
          <div style={{ gridColumn: 'span 3' }}><label className="form-label">Fabricante</label><input className="input" value={configuracao.fabricante} onChange={(e) => alterar('fabricante', e.target.value)} /></div>
          <div style={{ gridColumn: 'span 3' }}><label className="form-label">Modelo Prix</label><input className="input" placeholder="Ex.: Prix 4 Uno" value={configuracao.modelo} onChange={(e) => alterar('modelo', e.target.value)} /></div>
          <div style={{ gridColumn: 'span 3' }}><label className="form-label">Versão do MGV</label><input className="input" placeholder="Ex.: MGV 6" value={configuracao.versao_mgv} onChange={(e) => alterar('versao_mgv', e.target.value)} /></div>
          <div style={{ gridColumn: 'span 3' }}><label className="form-label">IP da balança</label><input className="input" placeholder="192.168.1.150" value={configuracao.ip} onChange={(e) => alterar('ip', e.target.value)} /></div>
          <div style={{ gridColumn: 'span 2' }}><label className="form-label">Porta</label><input className="input" type="number" min="0" max="65535" value={configuracao.porta} onChange={(e) => alterar('porta', e.target.value)} /></div>
          <div style={{ gridColumn: 'span 2' }}><label className="form-label">Departamento</label><input className="input" type="number" min="1" value={configuracao.departamento} onChange={(e) => alterar('departamento', e.target.value)} /></div>
          <div style={{ gridColumn: 'span 2' }}><label className="form-label">Validade padrão</label><input className="input" type="number" min="0" value={configuracao.validade_padrao_dias} onChange={(e) => alterar('validade_padrao_dias', e.target.value)} /></div>
          <div style={{ gridColumn: 'span 2' }}><label className="form-label">Prefixo EAN</label><input className="input" maxLength={1} inputMode="numeric" value={configuracao.prefixo_ean} onChange={(e) => alterar('prefixo_ean', e.target.value)} /></div>
        </div>

        <div className="modal-actions" style={{ marginTop: 24 }}>
          <button className="btn btn-primary" type="submit" disabled={salvando}>
            <Save size={16} /> {salvando ? 'Salvando...' : 'Salvar configuração'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={exportar} disabled={exportando}>
            <Download size={16} /> {exportando ? 'Gerando...' : 'Gerar carga CSV'}
          </button>
        </div>
      </form>
    </div>
  );
}
