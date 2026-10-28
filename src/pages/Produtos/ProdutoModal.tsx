import { useState, useEffect, ChangeEvent, FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { X, Package, DollarSign, Tag, Plus } from 'lucide-react';
import Modal from '../../components/Modal';

interface Grupo {
  id: string | number;
  nome: string;
}

interface Produto {
  id?: string | number;
  nome: string;
  codigo_legado: string;
  codigo_barras: string;
  preco_compra: number | string;
  preco_venda: number | string;
  unidade_medida: string;
  grupo: string;
  subgrupo: string;
  ativo: boolean;
  descricao_delivery: string;
  disponivel_delivery: boolean;
  imagem_url: string;
  tempo_preparo_minutos: number | string;
  ncm: string;
  cest: string;
  cfop: string;
  cst_icms: string;
  origem_mercadoria: string;
  aliquota_icms: number | string;
  aliquota_pis: number | string;
  aliquota_cofins: number | string;
  estoque_inicial?: number | string;
  estoque_atual?: number | string;
}

interface ProdutoModalProps {
  produto: Produto | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ProdutoModal({ produto, onClose, onSuccess }: ProdutoModalProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<Produto>({
    nome: '',
    codigo_legado: '',
    codigo_barras: '',
    preco_compra: '',
    preco_venda: '',
    unidade_medida: 'UN',
    grupo: '',
    subgrupo: '',
    ativo: true,
    descricao_delivery: '',
    disponivel_delivery: false,
    imagem_url: '',
    tempo_preparo_minutos: 15,
    ncm: '',
    cest: '',
    cfop: '5102',
    cst_icms: '102',
    origem_mercadoria: '0',
    aliquota_icms: 0,
    aliquota_pis: 0,
    aliquota_cofins: 0,
    estoque_inicial: 0
  });

  const [loading, setLoading] = useState(false);
  const [showAddGrupo, setShowAddGrupo] = useState(false);
  const [novoGrupo, setNovoGrupo] = useState('');
  const [margem, setMargem] = useState<number | string>('');

  // Fetch Categorias/Grupos
  const { data: grupos = [] } = useQuery<Grupo[]>({
    queryKey: ['grupos'],
    queryFn: async () => {
      const resp = await api.get('/grupos/');
      return Array.isArray(resp.data) ? resp.data : (resp.data.results || []);
    }
  });

  // Mutation para novo grupo
  const addGrupoMutation = useMutation({
    mutationFn: (nome: string) => api.post('/grupos/', { nome }),
    onSuccess: (resp) => {
      queryClient.invalidateQueries({ queryKey: ['grupos'] });
      setFormData(prev => ({ ...prev, grupo: resp.data.nome }));
      setShowAddGrupo(false);
      setNovoGrupo('');
    }
  });

  useEffect(() => {
    if (produto) {
      const precoCompra = Number(produto.preco_compra) || 0;
      const precoVenda = Number(produto.preco_venda) || 0;
      let margemInicial = '';

      if (precoCompra > 0) {
        margemInicial = (((precoVenda / precoCompra) - 1) * 100).toFixed(2);
      }

      setFormData({
        ...produto,
        codigo_legado: produto.codigo_legado || '',
        codigo_barras: produto.codigo_barras || '',
        preco_compra: produto.preco_compra ?? '',
        preco_venda: produto.preco_venda ?? '',
        estoque_inicial: produto.estoque_atual ?? 0,
      });
      setMargem(margemInicial);
    }
  }, [produto]);

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;

    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData(prev => ({ ...prev, [name]: checked }));
      return;
    }

    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    // Recalcular preço de venda se alterar custo
    if (name === 'preco_compra') {
       const custo = Number(value);
       const m = Number(margem);
       if (custo > 0 && m > 0) {
         const venda = custo * (1 + m / 100);
         setFormData(prev => ({ ...prev, preco_venda: venda.toFixed(2) }));
       }
    }

    // Recalcular margem se alterar preço de venda
    if (name === 'preco_venda') {
      const venda = Number(value);
      const custo = Number(formData.preco_compra);
      if (custo > 0 && venda > 0) {
        const m = ((venda / custo) - 1) * 100;
        setMargem(m.toFixed(2));
      }
   }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const dataToSubmit = {
        ...formData,
        preco_compra: formData.preco_compra === '' ? 0 : Number(formData.preco_compra),
        preco_venda: formData.preco_venda === '' ? 0 : Number(formData.preco_venda),
        tempo_preparo_minutos: Number(formData.tempo_preparo_minutos || 15),
        aliquota_icms: Number(formData.aliquota_icms || 0),
        aliquota_pis: Number(formData.aliquota_pis || 0),
        aliquota_cofins: Number(formData.aliquota_cofins || 0),
      };

      // Se for novo ou o código legado estiver vazio, removemos para o backend gerar
      if (!formData.codigo_legado || formData.codigo_legado === '') {
        delete (dataToSubmit as any).codigo_legado;
      }

      if (produto?.id) {
        await api.patch(`/produtos/${produto.id}/`, dataToSubmit);
      } else {
        await api.post('/produtos/', dataToSubmit);
      }
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Erro ao salvar produto:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      labelledBy="produto-modal-title"
      panelClassName="card animate-in modal-panel modal-panel-lg"
      closeOnBackdrop={false}
    >
        <div className="modal-titlebar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ padding: 8, background: 'rgba(59, 130, 246, 0.1)', borderRadius: 8, color: 'var(--accent)' }}>
              <Package size={20} />
            </div>
            <h2 id="produto-modal-title" style={{ fontSize: '1.25rem', fontWeight: 700 }}>
              {produto ? 'Editar Produto' : 'Cadastrar Novo Produto'}
            </h2>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fechar modal">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-grid-12" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 18 }}>

            {/* Dados Principais */}
            <div style={{ gridColumn: 'span 8' }}>
              <label className="form-label" htmlFor="produto-nome">Nome / Descrição do Produto</label>
              <input id="produto-nome" name="nome" value={formData.nome} onChange={handleChange} className="input" required placeholder="Ex: Batatas Lavadas 1kg" />
            </div>

            <div style={{ gridColumn: 'span 4' }}>
              <label className="form-label" htmlFor="produto-unidade">Unidade</label>
              <select id="produto-unidade" name="unidade_medida" value={formData.unidade_medida} onChange={handleChange} className="input">
                <option value="UN">Unidade (UN)</option>
                <option value="KG">Quilo (KG)</option>
                <option value="LT">Litro (LT)</option>
                <option value="CX">Caixa (CX)</option>
                <option value="FD">Fardo (FD)</option>
              </select>
            </div>


            <div style={{ gridColumn: 'span 12' }}>
              <label className="form-label" htmlFor="produto-codigo-barras">Código de Barras (EAN)</label>
              <input id="produto-codigo-barras" name="codigo_barras" value={formData.codigo_barras} onChange={handleChange} className="input" placeholder="7890000000000" />
            </div>

            <div style={{ gridColumn: 'span 3' }}>
              <label className="form-label" htmlFor="produto-preco-compra">Preço de Compra (R$)</label>
              <div style={{ position: 'relative' }}>
                <DollarSign size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
                <input id="produto-preco-compra" name="preco_compra" type="number" step="0.01" value={formData.preco_compra} onChange={handleChange} className="input" style={{ paddingLeft: 36 }} />
              </div>
            </div>

            <div style={{ gridColumn: 'span 3' }}>
              <label className="form-label" htmlFor="produto-margem">Margem (%)</label>
              <div style={{ position: 'relative' }}>
                <Tag size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
                <input
                  id="produto-margem"
                  name="margem"
                  type="number"
                  value={margem}
                  onChange={(e) => {
                    setMargem(e.target.value);
                    const m = Number(e.target.value);
                    const custo = Number(formData.preco_compra);
                    if (custo > 0 && m > 0) {
                      const venda = custo * (1 + m / 100);
                      setFormData(prev => ({ ...prev, preco_venda: venda.toFixed(2) }));
                    }
                  }}
                  className="input"
                  style={{ paddingLeft: 36 }}
                  placeholder="Ex: 30"
                />
              </div>
            </div>

            <div style={{ gridColumn: 'span 3' }}>
              <label className="form-label" htmlFor="produto-preco-venda">Preço de Venda (R$)</label>
              <div style={{ position: 'relative' }}>
                <DollarSign size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
                <input id="produto-preco-venda" name="preco_venda" type="number" step="0.01" value={formData.preco_venda} onChange={handleChange} className="input" style={{ paddingLeft: 36 }} required />
              </div>
            </div>

            <div style={{ gridColumn: 'span 3' }}>
              <label className="form-label" htmlFor="produto-estoque">Estoque {produto ? 'Atual' : 'Inicial'}</label>
              <div style={{ position: 'relative' }}>
                <Package size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
                <input
                  id="produto-estoque"
                  name="estoque_inicial"
                  type="number"
                  step="0.001"
                  value={formData.estoque_inicial}
                  onChange={handleChange}
                  className="input"
                  style={{ paddingLeft: 36 }}
                  placeholder="0,000"
                />
              </div>
            </div>

            <div style={{ gridColumn: 'span 6' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label className="form-label" htmlFor={showAddGrupo ? 'produto-novo-grupo' : 'produto-grupo'} style={{ marginBottom: 0 }}>Grupo / Categoria</label>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setShowAddGrupo(!showAddGrupo)}
                  style={{ minHeight: 34, padding: '4px 8px' }}
                >
                  <Plus size={10} style={{ marginRight: 2 }} />
                  {showAddGrupo ? 'Cancelar' : 'Novo Grupo'}
                </button>
              </div>

              {showAddGrupo ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    id="produto-novo-grupo"
                    className="input"
                    value={novoGrupo}
                    onChange={e => setNovoGrupo(e.target.value)}
                    placeholder="Nome do novo grupo..."
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => novoGrupo && addGrupoMutation.mutate(novoGrupo)}
                    disabled={addGrupoMutation.isPending}
                  >
                    OK
                  </button>
                </div>
              ) : (
                <select
                  id="produto-grupo"
                  name="grupo"
                  value={formData.grupo}
                  onChange={handleChange}
                  className="input"
                >
                  <option value="">Selecione um grupo...</option>
                  {grupos.map(g => (
                    <option key={g.id} value={g.nome}>{g.nome}</option>
                  ))}
                </select>
              )}
            </div>

            <div style={{ gridColumn: 'span 6' }}>
              <span className="form-label">Status</span>
              <label htmlFor="produto-ativo" style={{ display: 'flex', alignItems: 'center', gap: 10, height: 42, cursor: 'pointer' }}>
                <input id="produto-ativo" type="checkbox" name="ativo" checked={formData.ativo} onChange={handleChange} style={{ width: 18, height: 18 }} />
                <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Produto Ativo</span>
              </label>
            </div>

            <div style={{ gridColumn: 'span 12' }}>
              <details className="form-details" open={Boolean(formData.disponivel_delivery)}>
                <summary>Cardápio online e delivery</summary>
                <div className="form-grid-12" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 14, paddingTop: 14 }}>
                  <label style={{ gridColumn: 'span 12', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="checkbox" name="disponivel_delivery" checked={formData.disponivel_delivery} onChange={handleChange} style={{ width: 18, height: 18 }} />
                    <span>Disponível no cardápio online</span>
                  </label>
                  <div style={{ gridColumn: 'span 8' }}><label className="form-label" htmlFor="produto-imagem">URL da imagem</label><input id="produto-imagem" name="imagem_url" type="url" value={formData.imagem_url} onChange={handleChange} className="input" placeholder="https://..." /></div>
                  <div style={{ gridColumn: 'span 4' }}><label className="form-label" htmlFor="produto-preparo">Preparo (min)</label><input id="produto-preparo" name="tempo_preparo_minutos" type="number" min="1" value={formData.tempo_preparo_minutos} onChange={handleChange} className="input" /></div>
                  <div style={{ gridColumn: 'span 12' }}><label className="form-label" htmlFor="produto-descricao-delivery">Descrição para o cliente</label><textarea id="produto-descricao-delivery" name="descricao_delivery" rows={3} value={formData.descricao_delivery} onChange={handleChange} className="input" placeholder="Descreva o produto, tamanho e principais ingredientes" /></div>
                </div>
              </details>
            </div>

            <div style={{ gridColumn: 'span 12' }}>
              <details className="form-details">
                <summary>Classificação fiscal NFC-e / NF-e</summary>
                <p className="form-hint" style={{ marginTop: 8 }}>Preencha conforme a orientação do contador. O sistema inicia em homologação.</p>
                <div className="form-grid-12" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 14, paddingTop: 12 }}>
                  <div style={{ gridColumn: 'span 3' }}><label className="form-label">NCM</label><input className="input" name="ncm" maxLength={8} inputMode="numeric" value={formData.ncm} onChange={handleChange} /></div>
                  <div style={{ gridColumn: 'span 3' }}><label className="form-label">CEST</label><input className="input" name="cest" maxLength={7} inputMode="numeric" value={formData.cest} onChange={handleChange} /></div>
                  <div style={{ gridColumn: 'span 3' }}><label className="form-label">CFOP</label><input className="input" name="cfop" maxLength={4} inputMode="numeric" value={formData.cfop} onChange={handleChange} /></div>
                  <div style={{ gridColumn: 'span 3' }}><label className="form-label">CST / CSOSN</label><input className="input" name="cst_icms" maxLength={3} value={formData.cst_icms} onChange={handleChange} /></div>
                  <div style={{ gridColumn: 'span 3' }}><label className="form-label">Origem</label><select className="input" name="origem_mercadoria" value={formData.origem_mercadoria} onChange={handleChange}><option value="0">0 — Nacional</option><option value="1">1 — Importação direta</option><option value="2">2 — Mercado interno/importado</option></select></div>
                  <div style={{ gridColumn: 'span 3' }}><label className="form-label">ICMS (%)</label><input className="input" name="aliquota_icms" type="number" step="0.01" min="0" value={formData.aliquota_icms} onChange={handleChange} /></div>
                  <div style={{ gridColumn: 'span 3' }}><label className="form-label">PIS (%)</label><input className="input" name="aliquota_pis" type="number" step="0.01" min="0" value={formData.aliquota_pis} onChange={handleChange} /></div>
                  <div style={{ gridColumn: 'span 3' }}><label className="form-label">COFINS (%)</label><input className="input" name="aliquota_cofins" type="number" step="0.01" min="0" value={formData.aliquota_cofins} onChange={handleChange} /></div>
                </div>
              </details>
            </div>

          </div>

          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn btn-ghost">
              Descartar
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ minWidth: 140, justifyContent: 'center' }}>
              {loading ? 'Salvando...' : 'Confirmar Cadastro'}
            </button>
          </div>
        </form>
    </Modal>
  );
}
