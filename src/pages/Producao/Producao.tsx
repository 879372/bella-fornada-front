import { FormEvent, type ReactNode, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Flame,
  PackagePlus,
  Play,
  Plus,
  Trash2,
  Wheat,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import Modal from '../../components/Modal';
import api from '../../lib/api';

type Produto = {
  id: number;
  nome: string;
  unidade_medida: string;
};

type Ingrediente = {
  id?: number;
  ingrediente: number;
  ingrediente_nome?: string;
  unidade?: string;
  quantidade: string;
  percentual_perda: string;
};

type Receita = {
  id: number;
  produto: number;
  produto_nome: string;
  nome: string;
  rendimento: string;
  unidade_rendimento: string;
  tempo_preparo_minutos: number;
  instrucoes: string;
  ativa: boolean;
  ingredientes: Ingrediente[];
};

type Ordem = {
  id: number;
  receita: number;
  receita_nome: string;
  produto_nome: string;
  quantidade_lotes: string;
  quantidade_prevista: string;
  quantidade_produzida: string | null;
  status: 'PLANEJADA' | 'EM_PRODUCAO' | 'CONCLUIDA' | 'CANCELADA';
  data_planejada: string;
  codigo_lote: string;
  data_validade: string | null;
  observacoes: string;
};

type Perda = {
  id: number;
  produto_nome: string;
  quantidade: string;
  motivo: string;
  observacoes: string;
  created_at: string;
};

const statusLabel: Record<Ordem['status'], string> = {
  PLANEJADA: 'Planejada',
  EM_PRODUCAO: 'Em produção',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
};

const todayLocal = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
};

const unwrap = <T,>(data: T[] | { results: T[] }) => Array.isArray(data) ? data : data.results;

const emptyRecipe = {
  produto: '',
  nome: '',
  rendimento: '1',
  unidade_rendimento: 'UN',
  tempo_preparo_minutos: '60',
  instrucoes: '',
  ingredientes: [{ ingrediente: '', quantidade: '', percentual_perda: '0' }],
};

export default function Producao() {
  const client = useQueryClient();
  const [tab, setTab] = useState<'ordens' | 'receitas' | 'perdas'>('ordens');
  const [modal, setModal] = useState<'ordem' | 'receita' | 'perda' | null>(null);
  const [recipeForm, setRecipeForm] = useState(emptyRecipe);
  const [orderForm, setOrderForm] = useState({
    receita: '', quantidade_lotes: '1', data_planejada: todayLocal(),
    codigo_lote: '', data_validade: '', observacoes: '',
  });
  const [lossForm, setLossForm] = useState({
    produto: '', quantidade: '', motivo: 'SOBRA', observacoes: '',
  });

  const productsQuery = useQuery<Produto[]>({
    queryKey: ['produtos-producao'],
    queryFn: async () => unwrap<Produto>((await api.get('/produtos/', { params: { ordering: 'nome' } })).data),
  });
  const recipesQuery = useQuery<Receita[]>({
    queryKey: ['receitas-producao'],
    queryFn: async () => unwrap<Receita>((await api.get('/producao/receitas/')).data),
  });
  const ordersQuery = useQuery<Ordem[]>({
    queryKey: ['ordens-producao'],
    queryFn: async () => unwrap<Ordem>((await api.get('/producao/ordens/')).data),
    refetchInterval: 30_000,
  });
  const lossesQuery = useQuery<Perda[]>({
    queryKey: ['perdas-producao'],
    queryFn: async () => unwrap<Perda>((await api.get('/producao/perdas/')).data),
  });

  const invalidate = () => {
    client.invalidateQueries({ queryKey: ['receitas-producao'] });
    client.invalidateQueries({ queryKey: ['ordens-producao'] });
    client.invalidateQueries({ queryKey: ['perdas-producao'] });
    client.invalidateQueries({ queryKey: ['produtos-data'] });
  };

  const saveRecipe = useMutation({
    mutationFn: () => api.post('/producao/receitas/', {
      ...recipeForm,
      produto: Number(recipeForm.produto),
      tempo_preparo_minutos: Number(recipeForm.tempo_preparo_minutos),
      ingredientes: recipeForm.ingredientes.map((item) => ({
        ingrediente: Number(item.ingrediente),
        quantidade: item.quantidade,
        percentual_perda: item.percentual_perda || '0',
      })),
    }),
    onSuccess: () => {
      toast.success('Ficha técnica criada.');
      setRecipeForm(emptyRecipe);
      setModal(null);
      invalidate();
    },
  });

  const saveOrder = useMutation({
    mutationFn: () => api.post('/producao/ordens/', {
      ...orderForm,
      receita: Number(orderForm.receita),
      data_validade: orderForm.data_validade || null,
      data_planejada: new Date(orderForm.data_planejada).toISOString(),
    }),
    onSuccess: () => {
      toast.success('Ordem de produção planejada.');
      setOrderForm({ receita: '', quantidade_lotes: '1', data_planejada: todayLocal(), codigo_lote: '', data_validade: '', observacoes: '' });
      setModal(null);
      invalidate();
    },
  });

  const saveLoss = useMutation({
    mutationFn: () => api.post('/producao/perdas/', {
      ...lossForm,
      produto: Number(lossForm.produto),
    }),
    onSuccess: () => {
      toast.success('Perda registrada e estoque atualizado.');
      setLossForm({ produto: '', quantidade: '', motivo: 'SOBRA', observacoes: '' });
      setModal(null);
      invalidate();
    },
  });

  const transition = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'iniciar' | 'concluir' | 'cancelar' }) =>
      api.post(`/producao/ordens/${id}/${action}/`, {}),
    onSuccess: (_, values) => {
      toast.success(values.action === 'iniciar' ? 'Produção iniciada.' : values.action === 'concluir' ? 'Produção concluída e estoque atualizado.' : 'Ordem cancelada.');
      invalidate();
    },
  });

  const orders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);
  const stats = useMemo(() => ({
    planned: orders.filter((item) => item.status === 'PLANEJADA').length,
    active: orders.filter((item) => item.status === 'EM_PRODUCAO').length,
    done: orders.filter((item) => item.status === 'CONCLUIDA').length,
  }), [orders]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (modal === 'receita') saveRecipe.mutate();
    if (modal === 'ordem') saveOrder.mutate();
    if (modal === 'perda') saveLoss.mutate();
  };

  const busy = saveRecipe.isPending || saveOrder.isPending || saveLoss.isPending;

  return (
    <div className="animate-in">
      <div className="page-header page-header-row">
        <div>
          <h1 className="page-title">Produção e fornadas</h1>
          <p className="page-subtitle">Fichas técnicas, planejamento, lotes, validade e perdas</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={() => setModal('perda')}><Trash2 size={17} /> Registrar perda</button>
          <button className="btn btn-primary" onClick={() => setModal(tab === 'receitas' ? 'receita' : 'ordem')}><Plus size={17} /> {tab === 'receitas' ? 'Nova ficha técnica' : 'Planejar fornada'}</button>
        </div>
      </div>

      <div className="kpi-grid compact-kpis">
        <div className="kpi-card yellow"><div className="kpi-label">Planejadas</div><div className="kpi-value">{stats.planned}</div></div>
        <div className="kpi-card blue"><div className="kpi-label">Em produção</div><div className="kpi-value">{stats.active}</div></div>
        <div className="kpi-card green"><div className="kpi-label">Concluídas</div><div className="kpi-value">{stats.done}</div></div>
      </div>

      <div className="tab-group" style={{ marginBottom: 16 }}>
        <button className={tab === 'ordens' ? 'active' : ''} onClick={() => setTab('ordens')}><ClipboardList size={16} /> Ordens</button>
        <button className={tab === 'receitas' ? 'active' : ''} onClick={() => setTab('receitas')}><Wheat size={16} /> Fichas técnicas</button>
        <button className={tab === 'perdas' ? 'active' : ''} onClick={() => setTab('perdas')}><AlertTriangle size={16} /> Perdas</button>
      </div>

      {tab === 'ordens' && (
        <div className="card table-card">
          {ordersQuery.isLoading ? <div className="loading">Carregando ordens...</div> : orders.length === 0 ? <Empty icon={<Flame size={44} />} title="Nenhuma fornada planejada" /> : (
            <div className="table-wrapper"><table className="table"><thead><tr><th>Produto</th><th>Planejamento</th><th>Lote / validade</th><th>Quantidade</th><th>Status</th><th>Ações</th></tr></thead><tbody>
              {orders.map((order) => <tr key={order.id}>
                <td><strong>{order.produto_nome}</strong><div className="mono-muted">{order.receita_nome}</div></td>
                <td>{new Date(order.data_planejada).toLocaleString('pt-BR')}</td>
                <td>{order.codigo_lote || '—'}<div className="mono-muted">{order.data_validade ? new Date(`${order.data_validade}T12:00:00`).toLocaleDateString('pt-BR') : 'Sem validade informada'}</div></td>
                <td>{order.quantidade_produzida || order.quantidade_prevista}</td>
                <td><span className={`badge ${order.status === 'CONCLUIDA' ? 'badge-success' : order.status === 'CANCELADA' ? 'badge-danger' : 'badge-warning'}`}>{statusLabel[order.status]}</span></td>
                <td><div style={{ display: 'flex', gap: 6 }}>
                  {order.status === 'PLANEJADA' && <button className="btn btn-ghost btn-sm" onClick={() => transition.mutate({ id: order.id, action: 'iniciar' })}><Play size={14} /> Iniciar</button>}
                  {order.status === 'EM_PRODUCAO' && <button className="btn btn-primary btn-sm" onClick={() => transition.mutate({ id: order.id, action: 'concluir' })}><CheckCircle2 size={14} /> Concluir</button>}
                  {['PLANEJADA', 'EM_PRODUCAO'].includes(order.status) && <button className="btn btn-danger btn-sm" onClick={() => transition.mutate({ id: order.id, action: 'cancelar' })}>Cancelar</button>}
                </div></td>
              </tr>)}
            </tbody></table></div>
          )}
        </div>
      )}

      {tab === 'receitas' && (
        <div className="card table-card">
          {recipesQuery.isLoading ? <div className="loading">Carregando fichas...</div> : !recipesQuery.data?.length ? <Empty icon={<Wheat size={44} />} title="Nenhuma ficha técnica" /> : (
            <div className="table-wrapper"><table className="table"><thead><tr><th>Ficha</th><th>Produto final</th><th>Rendimento</th><th>Tempo</th><th>Ingredientes</th></tr></thead><tbody>
              {recipesQuery.data.map((recipe) => <tr key={recipe.id}><td><strong>{recipe.nome}</strong></td><td>{recipe.produto_nome}</td><td>{recipe.rendimento} {recipe.unidade_rendimento}</td><td>{recipe.tempo_preparo_minutos} min</td><td>{recipe.ingredientes.map((item) => `${item.ingrediente_nome} (${item.quantidade} ${item.unidade || ''})`).join(', ')}</td></tr>)}
            </tbody></table></div>
          )}
        </div>
      )}

      {tab === 'perdas' && (
        <div className="card table-card">
          {lossesQuery.isLoading ? <div className="loading">Carregando perdas...</div> : !lossesQuery.data?.length ? <Empty icon={<AlertTriangle size={44} />} title="Nenhuma perda registrada" /> : (
            <div className="table-wrapper"><table className="table"><thead><tr><th>Data</th><th>Produto</th><th>Quantidade</th><th>Motivo</th><th>Observação</th></tr></thead><tbody>
              {lossesQuery.data.map((loss) => <tr key={loss.id}><td>{new Date(loss.created_at).toLocaleString('pt-BR')}</td><td><strong>{loss.produto_nome}</strong></td><td>{loss.quantidade}</td><td>{loss.motivo.replace(/_/g, ' ')}</td><td>{loss.observacoes || '—'}</td></tr>)}
            </tbody></table></div>
          )}
        </div>
      )}

      {modal && <Modal onClose={() => setModal(null)} labelledBy="production-modal-title" panelClassName="modal-content modal-panel" panelStyle={{ maxWidth: modal === 'receita' ? 760 : 560 }}>
        <div className="modal-header"><div><h2 id="production-modal-title" className="modal-title">{modal === 'receita' ? 'Nova ficha técnica' : modal === 'ordem' ? 'Planejar fornada' : 'Registrar perda'}</h2><p className="modal-subtitle">{modal === 'receita' ? 'Defina o rendimento e o consumo de cada insumo.' : modal === 'ordem' ? 'A conclusão baixa ingredientes e dá entrada no produto final.' : 'A perda será baixada imediatamente do estoque.'}</p></div><button className="btn-icon" onClick={() => setModal(null)}><X size={20} /></button></div>
        <form onSubmit={submit}>
          {modal === 'receita' && <RecipeFields form={recipeForm} setForm={setRecipeForm} products={productsQuery.data ?? []} />}
          {modal === 'ordem' && <div className="form-grid-2">
            <label className="form-group form-span-2"><span className="form-label">Ficha técnica *</span><select className="input" required value={orderForm.receita} onChange={(event) => setOrderForm({ ...orderForm, receita: event.target.value })}><option value="">Selecione</option>{recipesQuery.data?.filter((item) => item.ativa).map((item) => <option value={item.id} key={item.id}>{item.nome} — {item.produto_nome}</option>)}</select></label>
            <label className="form-group"><span className="form-label">Quantidade de lotes *</span><input className="input" type="number" min="0.001" step="0.001" required value={orderForm.quantidade_lotes} onChange={(event) => setOrderForm({ ...orderForm, quantidade_lotes: event.target.value })} /></label>
            <label className="form-group"><span className="form-label">Data planejada *</span><input className="input" type="datetime-local" required value={orderForm.data_planejada} onChange={(event) => setOrderForm({ ...orderForm, data_planejada: event.target.value })} /></label>
            <label className="form-group"><span className="form-label">Código do lote</span><input className="input" value={orderForm.codigo_lote} onChange={(event) => setOrderForm({ ...orderForm, codigo_lote: event.target.value })} /></label>
            <label className="form-group"><span className="form-label">Validade</span><input className="input" type="date" value={orderForm.data_validade} onChange={(event) => setOrderForm({ ...orderForm, data_validade: event.target.value })} /></label>
            <label className="form-group form-span-2"><span className="form-label">Observações</span><textarea className="input" rows={3} value={orderForm.observacoes} onChange={(event) => setOrderForm({ ...orderForm, observacoes: event.target.value })} /></label>
          </div>}
          {modal === 'perda' && <div className="form-grid-2">
            <label className="form-group form-span-2"><span className="form-label">Produto *</span><select className="input" required value={lossForm.produto} onChange={(event) => setLossForm({ ...lossForm, produto: event.target.value })}><option value="">Selecione</option>{productsQuery.data?.map((item) => <option value={item.id} key={item.id}>{item.nome}</option>)}</select></label>
            <label className="form-group"><span className="form-label">Quantidade *</span><input className="input" required type="number" min="0.001" step="0.001" value={lossForm.quantidade} onChange={(event) => setLossForm({ ...lossForm, quantidade: event.target.value })} /></label>
            <label className="form-group"><span className="form-label">Motivo *</span><select className="input" value={lossForm.motivo} onChange={(event) => setLossForm({ ...lossForm, motivo: event.target.value })}><option value="SOBRA">Sobra</option><option value="VENCIMENTO">Vencimento</option><option value="AVARIA">Avaria</option><option value="ERRO_PRODUCAO">Erro de produção</option><option value="OUTRO">Outro</option></select></label>
            <label className="form-group form-span-2"><span className="form-label">Observações</span><textarea className="input" rows={3} value={lossForm.observacoes} onChange={(event) => setLossForm({ ...lossForm, observacoes: event.target.value })} /></label>
          </div>}
          <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando...' : 'Salvar'}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

function RecipeFields({ form, setForm, products }: { form: typeof emptyRecipe; setForm: (value: typeof emptyRecipe) => void; products: Produto[] }) {
  const updateIngredient = (index: number, field: 'ingrediente' | 'quantidade' | 'percentual_perda', value: string) => setForm({ ...form, ingredientes: form.ingredientes.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) });
  return <div className="form-grid-2">
    <label className="form-group"><span className="form-label">Produto final *</span><select className="input" required value={form.produto} onChange={(event) => setForm({ ...form, produto: event.target.value })}><option value="">Selecione</option>{products.map((item) => <option value={item.id} key={item.id}>{item.nome}</option>)}</select></label>
    <label className="form-group"><span className="form-label">Nome da ficha *</span><input className="input" required value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} /></label>
    <label className="form-group"><span className="form-label">Rendimento por lote *</span><input className="input" type="number" min="0.001" step="0.001" required value={form.rendimento} onChange={(event) => setForm({ ...form, rendimento: event.target.value })} /></label>
    <label className="form-group"><span className="form-label">Unidade</span><input className="input" value={form.unidade_rendimento} onChange={(event) => setForm({ ...form, unidade_rendimento: event.target.value.toUpperCase() })} /></label>
    <label className="form-group"><span className="form-label">Preparo (minutos)</span><input className="input" type="number" min="1" value={form.tempo_preparo_minutos} onChange={(event) => setForm({ ...form, tempo_preparo_minutos: event.target.value })} /></label>
    <label className="form-group form-span-2"><span className="form-label">Instruções</span><textarea className="input" rows={3} value={form.instrucoes} onChange={(event) => setForm({ ...form, instrucoes: event.target.value })} /></label>
    <div className="form-group form-span-2"><span className="form-label">Ingredientes *</span>{form.ingredientes.map((item, index) => <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 90px 38px', gap: 8, marginBottom: 8 }}><select className="input" required value={item.ingrediente} onChange={(event) => updateIngredient(index, 'ingrediente', event.target.value)}><option value="">Selecione</option>{products.filter((product) => String(product.id) !== form.produto).map((product) => <option value={product.id} key={product.id}>{product.nome}</option>)}</select><input className="input" type="number" min="0.001" step="0.001" placeholder="Qtd." required value={item.quantidade} onChange={(event) => updateIngredient(index, 'quantidade', event.target.value)} /><input className="input" type="number" min="0" step="0.01" title="Percentual de perda" value={item.percentual_perda} onChange={(event) => updateIngredient(index, 'percentual_perda', event.target.value)} /><button type="button" className="btn-icon" disabled={form.ingredientes.length === 1} onClick={() => setForm({ ...form, ingredientes: form.ingredientes.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={16} /></button></div>)}<button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, ingredientes: [...form.ingredientes, { ingrediente: '', quantidade: '', percentual_perda: '0' }] })}><PackagePlus size={15} /> Adicionar ingrediente</button></div>
  </div>;
}

function Empty({ icon, title }: { icon: ReactNode; title: string }) {
  return <div className="empty-state">{icon}<h3>{title}</h3><p>Use o botão acima para começar.</p></div>;
}

