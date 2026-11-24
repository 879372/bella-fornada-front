import { FormEvent, useEffect, useState } from 'react';
import { Download, FolderOpen, Save, Scale } from 'lucide-react';
import { toast } from 'sonner';

import api from '../../lib/api';
import {
  PASTA_BALANCA_SUGERIDA,
  baixarArquivo,
  gravarNaPasta,
  nomePastaSalva,
  obterPastaBalanca,
  suportaGravarNaPasta,
} from '../../lib/pastaBalanca';

const ARQUIVOS = { itensmgv: 'ITENSMGV.TXT', depto: 'DEPTO.TXT' } as const;

async function gerarArquivos(): Promise<Record<string, Blob>> {
  const arquivos = await Promise.all(Object.entries(ARQUIVOS).map(async ([parametro, nome]) => {
    const { data } = await api.get<Blob>('/balancas/exportar/', {
      params: { arquivo: parametro },
      responseType: 'blob',
    });
    return [nome, data] as const;
  }));
  return Object.fromEntries(arquivos);
}

async function mensagemDeErro(erro: unknown): Promise<string> {
  const data = (erro as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try {
      const json = JSON.parse(await data.text());
      if (json?.detail) return json.detail;
    } catch {
      // resposta não era JSON
    }
  }
  return 'Não foi possível gerar a carga da balança.';
}

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
  const [pastaSalva, setPastaSalva] = useState<string | null>(null);
  const gravaNaPasta = suportaGravarNaPasta();

  useEffect(() => {
    if (gravaNaPasta) nomePastaSalva().then(setPastaSalva);
  }, [gravaNaPasta]);

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

  const exportar = async (trocarPasta = false) => {
    setExportando(true);
    try {
      if (gravaNaPasta) {
        let pasta;
        try {
          pasta = await obterPastaBalanca(trocarPasta);
        } catch (erro) {
          if ((erro as DOMException)?.name === 'AbortError') return;
          throw erro;
        }
        // A escolha/permissão deve acontecer antes da rede, durante o clique.
        const arquivos = await gerarArquivos();
        await gravarNaPasta(pasta, arquivos);
        setPastaSalva(pasta.name);
        toast.success(`ITENSMGV.TXT e DEPTO.TXT gravados na pasta ${pasta.name}. Agora importe no MGV.`);
      } else {
        const arquivos = await gerarArquivos();
        Object.entries(arquivos).forEach(([nome, conteudo]) => baixarArquivo(nome, conteudo));
        toast.success(`Arquivos baixados. Mova ITENSMGV.TXT e DEPTO.TXT para ${PASTA_BALANCA_SUGERIDA}.`);
      }
    } catch (erro) {
      toast.error(await mensagemDeErro(erro));
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
          <p>Configure a Prix e gere a carga (ITENSMGV.TXT e DEPTO.TXT) para o MGV.</p>
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
          <button className="btn btn-secondary" type="button" onClick={() => exportar()} disabled={exportando}>
            <Download size={16} /> {exportando ? 'Gerando...' : 'Gerar carga MGV'}
          </button>
          {gravaNaPasta && pastaSalva && (
            <button className="btn btn-secondary" type="button" onClick={() => exportar(true)} disabled={exportando}>
              <FolderOpen size={16} /> Trocar pasta
            </button>
          )}
        </div>
        <p className="form-hint" style={{ marginTop: 12 }}>
          Vão para a carga os produtos ativos marcados com "Enviar para a balança" no cadastro.{' '}
          {gravaNaPasta
            ? pastaSalva
              ? `Os arquivos serão gravados na pasta ${pastaSalva}.`
              : `Na primeira vez, escolha a pasta ${PASTA_BALANCA_SUGERIDA}. Ela fica lembrada neste computador.`
            : `Este navegador só baixa os arquivos: mova-os para ${PASTA_BALANCA_SUGERIDA} ou use o Chrome/Edge para gravar direto.`}
        </p>
      </form>
    </div>
  );
}
