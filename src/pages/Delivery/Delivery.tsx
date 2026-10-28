import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import axios from 'axios';
import {
  BellRing,
  Bike,
  Check,
  ChevronRight,
  Clock3,
  MapPin,
  Printer,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShoppingBag,
  Store,
  Truck,
  WalletCards,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { normalizeCollection, normalizeOrder, numeric, record, text, truthy } from '../../online/normalizers';
import { isAutoPrintEnabled, printDeliveryOrder, setAutoPrintEnabled } from '../../online/order-receipt';
import type { DeliveryOrder, PaymentMethod } from '../../online/types';
import './delivery.css';

type DeliveryTab = 'fila' | 'bairros' | 'configuracao';

type NeighborhoodAdmin = {
  id: string;
  name: string;
  fee: number;
  active: boolean;
};

type DeliveryConfiguration = {
  id: string;
  acceptingOrders: boolean;
  whatsapp: string;
  pixKey: string;
  pixHolder: string;
  pickupMinutes: number;
  deliveryMinutes: number;
};

const EMPTY_CONFIG: DeliveryConfiguration = {
  id: '',
  acceptingOrders: true,
  whatsapp: '',
  pixKey: '',
  pixHolder: '',
  pickupMinutes: 25,
  deliveryMinutes: 50,
};

const STATUS_LABELS: Record<string, string> = {
  RECEBIDO: 'Recebido',
  AGUARDANDO_PAGAMENTO: 'Aguardando Pix',
  CONFIRMADO: 'Confirmado',
  EM_PREPARO: 'Em preparo',
  PRONTO: 'Pronto',
  SAIU_ENTREGA: 'Saiu para entrega',
  CONCLUIDO: 'Concluido',
  CANCELADO: 'Cancelado',
};

const STATUS_ACTIONS: Record<string, Array<{ status: string; label: string }>> = {
  RECEBIDO: [{ status: 'CONFIRMADO', label: 'Confirmar pedido' }, { status: 'CANCELADO', label: 'Cancelar' }],
  AGUARDANDO_PAGAMENTO: [{ status: 'CONFIRMAR_PIX', label: 'Confirmar Pix' }, { status: 'CANCELADO', label: 'Cancelar' }],
  CONFIRMADO: [{ status: 'EM_PREPARO', label: 'Iniciar preparo' }, { status: 'CANCELADO', label: 'Cancelar' }],
  EM_PREPARO: [{ status: 'PRONTO', label: 'Marcar como pronto' }, { status: 'CANCELADO', label: 'Cancelar' }],
  PRONTO: [{ status: 'SAIU_ENTREGA', label: 'Saiu para entrega' }, { status: 'CONCLUIDO', label: 'Concluir retirada' }, { status: 'CANCELADO', label: 'Cancelar' }],
  SAIU_ENTREGA: [{ status: 'CONCLUIDO', label: 'Concluir entrega' }, { status: 'CANCELADO', label: 'Cancelar' }],
};

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateTime = (value: string) => value ? new Date(value).toLocaleString('pt-BR') : '-';

async function getWithFallback<T>(primary: string, fallback: string, params?: Record<string, unknown>): Promise<T> {
  try {
    return (await api.get<T>(primary, { params })).data;
  } catch (error) {
    if (!axios.isAxiosError(error) || ![404, 405].includes(error.response?.status || 0)) throw error;
    return (await api.get<T>(fallback, { params })).data;
  }
}

export default function Delivery() {
  const [tab, setTab] = useState<DeliveryTab>('fila');
  return (
    <div className="delivery-page animate-in">
      <header className="page-header delivery-page-head">
        <div><h1 className="page-title">Delivery</h1><p className="page-subtitle">Pedidos online, bairros atendidos e configuracao do cardapio.</p></div>
        <a className="btn btn-ghost" href="/cardapio" target="_blank" rel="noreferrer"><Store size={17} /> Abrir cardapio</a>
      </header>
      <nav className="delivery-tabs" aria-label="Modulos do delivery">
        <button className={tab === 'fila' ? 'active' : ''} onClick={() => setTab('fila')}><BellRing /> Fila de pedidos</button>
        <button className={tab === 'bairros' ? 'active' : ''} onClick={() => setTab('bairros')}><MapPin /> Bairros e taxas</button>
        <button className={tab === 'configuracao' ? 'active' : ''} onClick={() => setTab('configuracao')}><Settings2 /> Configuracao</button>
      </nav>
      {tab === 'fila' && <OrderQueue />}
      {tab === 'bairros' && <Neighborhoods />}
      {tab === 'configuracao' && <Configuration />}
    </div>
  );
}

function OrderQueue() {
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [selected, setSelected] = useState<DeliveryOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ATIVOS');
  const [autoPrint, setAutoPrint] = useState(isAutoPrintEnabled);
  const knownOrders = useRef<Set<string> | null>(null);

  const loadOrders = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const raw = await getWithFallback<unknown>('/delivery/pedidos/', '/delivery/pedidos-internos/', { ordering: '-created_at' });
      const normalized = normalizeCollection(raw).map(normalizeOrder);
      const previous = knownOrders.current;
      if (previous && isAutoPrintEnabled()) {
        const newcomers = normalized.filter(order => !previous.has(String(order.id)) && !['CONCLUIDO', 'CANCELADO'].includes(order.status));
        for (const order of newcomers) void printDeliveryOrder(order);
      }
      knownOrders.current = new Set(normalized.map(order => String(order.id)));
      setOrders(normalized);
      setSelected(current => current ? normalized.find(order => String(order.id) === String(current.id)) || current : null);
      setError('');
    } catch (requestError) {
      setError(apiMessage(requestError, 'Nao foi possivel carregar os pedidos.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders(true);
    const timer = window.setInterval(() => void loadOrders(true), 20_000);
    return () => window.clearInterval(timer);
  }, [loadOrders]);

  const filtered = orders.filter(order => {
    const matchesQuery = !query.trim() || [order.id, order.customerName, order.customerPhone]
      .some(value => String(value).toLowerCase().includes(query.trim().toLowerCase()));
    const matchesStatus = statusFilter === 'TODOS'
      || (statusFilter === 'ATIVOS' && !['CONCLUIDO', 'CANCELADO'].includes(order.status))
      || order.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  const activeCount = orders.filter(order => !['CONCLUIDO', 'CANCELADO'].includes(order.status)).length;
  const preparingCount = orders.filter(order => ['CONFIRMADO', 'EM_PREPARO'].includes(order.status)).length;
  const readyCount = orders.filter(order => ['PRONTO', 'SAIU_ENTREGA'].includes(order.status)).length;

  return (
    <>
      <section className="delivery-kpis">
        <div><span>Na fila</span><strong>{activeCount}</strong><BellRing /></div>
        <div><span>Em producao</span><strong>{preparingCount}</strong><Clock3 /></div>
        <div><span>Prontos / entrega</span><strong>{readyCount}</strong><Bike /></div>
      </section>

      <section className="card delivery-toolbar">
        <div className="delivery-search"><Search /><input aria-label="Buscar pedido" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por pedido, cliente ou telefone" /></div>
        <select aria-label="Filtrar status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
          <option value="ATIVOS">Pedidos ativos</option><option value="TODOS">Todos os pedidos</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        <button className="btn btn-ghost" onClick={() => void loadOrders()} disabled={refreshing}><RefreshCw className={refreshing ? 'spin' : ''} /> Atualizar</button>
      </section>

      <label className={`delivery-auto-print ${autoPrint ? 'on' : ''}`}>
        <input type="checkbox" checked={autoPrint} onChange={event => { setAutoPrintEnabled(event.target.checked); setAutoPrint(event.target.checked); }} />
        <span className="delivery-switch" />
        <span><strong><Printer /> Imprimir pedidos novos automaticamente</strong><small>Ative apenas no computador conectado a impressora do caixa.</small></span>
      </label>

      {error && <div className="delivery-alert error">{error}</div>}
      <section className="delivery-board">
        {loading ? <div className="delivery-empty">Carregando pedidos...</div> : filtered.length === 0 ? <div className="delivery-empty">Nenhum pedido encontrado.</div> : filtered.map(order => (
          <button className={`delivery-order-card status-${order.status.toLowerCase()}`} key={order.id} onClick={() => setSelected(order)}>
            <header><span>#{order.id}</span><time>{order.createdAt ? new Date(order.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</time></header>
            <h2>{order.customerName}</h2>
            <p>{order.fulfillmentLabel} · {order.statusLabel || STATUS_LABELS[order.status] || order.status}</p>
            <footer><strong>{money(order.total)}</strong><ChevronRight /></footer>
          </button>
        ))}
      </section>

      {selected && <OrderDetail order={selected} onClose={() => setSelected(null)} onUpdated={updated => { setSelected(updated); void loadOrders(true); }} />}
    </>
  );
}

function OrderDetail({ order, onClose, onUpdated }: { order: DeliveryOrder; onClose: () => void; onUpdated: (order: DeliveryOrder) => void }) {
  const [pending, setPending] = useState<{ status: string; label: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(order.paymentMethod);
  const [cashReceived, setCashReceived] = useState(order.changeFor ? String(order.changeFor) : String(order.total));
  const actions = (STATUS_ACTIONS[order.status] || []).filter(action => {
    if (action.status === 'SAIU_ENTREGA') return order.fulfillment === 'ENTREGA';
    if (action.status === 'CONCLUIDO') return order.fulfillment === 'RETIRADA' || order.status === 'SAIU_ENTREGA';
    return true;
  });

  const execute = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      let response;
      if (pending.status === 'CONFIRMAR_PIX') {
        response = await api.post(`/delivery/pedidos/${order.id}/confirmar-pagamento/`);
      } else {
        const received = Number(cashReceived.replace(',', '.'));
        response = await api.post(`/delivery/pedidos/${order.id}/alterar-status/`, {
          status: pending.status,
          motivo_cancelamento: pending.status === 'CANCELADO' ? cancelReason.trim() : undefined,
          pagamento_confirmado: pending.status === 'CONCLUIDO' ? true : undefined,
          payment_method: pending.status === 'CONCLUIDO' ? paymentMethod : undefined,
          troco_para: pending.status === 'CONCLUIDO' && paymentMethod === 'DINHEIRO' && received > order.total ? received.toFixed(2) : undefined,
        });
      }
      const updated = normalizeOrder(response.data);
      onUpdated(updated.id ? updated : { ...order, status: pending.status });
      toast.success(pending.status === 'CONFIRMAR_PIX' ? 'Pagamento Pix confirmado.' : 'Pedido atualizado.');
      setPending(null);
    } catch (requestError) {
      toast.error(apiMessage(requestError, 'Nao foi possivel atualizar o pedido.'));
    } finally {
      setSaving(false);
    }
  };

  const needsCancelReason = pending?.status === 'CANCELADO';
  const completing = pending?.status === 'CONCLUIDO';
  const received = Number(cashReceived.replace(',', '.'));
  const cashInvalid = completing && paymentMethod === 'DINHEIRO' && (!Number.isFinite(received) || received < order.total);

  return (
    <div className="delivery-detail-overlay">
      <aside className="delivery-detail" role="dialog" aria-modal="true" aria-label={`Pedido ${order.id}`}>
        <header className="delivery-detail-head"><div><span>Pedido #{order.id}</span><h2>{order.customerName}</h2><small>{dateTime(order.createdAt)}</small></div><button onClick={onClose}><X /></button></header>
        <div className="delivery-detail-scroll">
          <div className={`delivery-status-pill status-${order.status.toLowerCase()}`}>{order.statusLabel || STATUS_LABELS[order.status] || order.status}</div>
          <section className="delivery-detail-card">
            <h3><ShoppingBag /> Itens do pedido</h3>
            {order.items.map(item => <div className="delivery-detail-item" key={item.id}><span><b>{item.quantity}x {item.productName}</b>{item.options.length > 0 && <small>{item.options.map(option => option.optionName).join(', ')}</small>}{item.notes && <small>Obs.: {item.notes}</small>}</span><strong>{money(item.subtotal)}</strong></div>)}
            <div className="delivery-detail-totals"><span>Subtotal <b>{money(order.subtotal)}</b></span><span>Taxa de entrega <b>{money(order.deliveryFee)}</b></span><strong>Total <b>{money(order.total)}</b></strong></div>
          </section>
          <section className="delivery-detail-card"><h3>{order.fulfillment === 'ENTREGA' ? <Truck /> : <Store />} {order.fulfillmentLabel}</h3>{order.fulfillment === 'ENTREGA' ? <p>{order.address}, {order.number}{order.complement && ` · ${order.complement}`}<br />{order.neighborhoodName} · {order.city}/{order.state}<br />CEP {order.cep}{order.reference && <><br />Ref.: {order.reference}</>}</p> : <p>Cliente retira na Bella Fornada.</p>}<a href={`https://wa.me/55${order.customerPhone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">{order.customerPhone} · abrir WhatsApp</a></section>
          <section className="delivery-detail-card"><h3><WalletCards /> Pagamento</h3><p>{order.paymentMethod}{order.changeFor ? ` · troco para ${money(order.changeFor)}` : ''}</p>{order.paymentConfirmed && <span className="delivery-payment-ok"><Check /> Pagamento confirmado</span>}</section>
          {order.notes && <section className="delivery-detail-card"><h3>Observacoes</h3><p>{order.notes}</p></section>}
        </div>
        <footer className="delivery-detail-actions">
          <button className="print" onClick={() => void printDeliveryOrder(order)}><Printer /> Imprimir</button>
          {actions.map(action => <button className={action.status === 'CANCELADO' ? 'danger' : ''} key={action.status} onClick={() => setPending(action)}>{action.label}</button>)}
        </footer>
      </aside>

      {pending && (
        <div className="delivery-confirm-overlay">
          <section className="delivery-confirm" role="alertdialog" aria-modal="true">
            <span>Confirmacao</span><h2>{pending.label}?</h2>
            {needsCancelReason && <label>Motivo do cancelamento<textarea autoFocus value={cancelReason} onChange={event => setCancelReason(event.target.value)} minLength={3} maxLength={255} /></label>}
            {completing && <div className="delivery-payment-form"><p>Confira como o cliente pagou antes de concluir.</p><div>{(['PIX', 'DINHEIRO', 'CARTAO'] as PaymentMethod[]).map(method => <button type="button" className={paymentMethod === method ? 'active' : ''} key={method} onClick={() => setPaymentMethod(method)}>{method}</button>)}</div>{paymentMethod === 'DINHEIRO' && <label>Valor recebido<input inputMode="decimal" value={cashReceived} onChange={event => setCashReceived(event.target.value)} />{cashInvalid && <small>Informe pelo menos {money(order.total)}.</small>}</label>}</div>}
            {!needsCancelReason && !completing && <p>O andamento sera atualizado para a equipe e para o cliente.</p>}
            <footer><button onClick={() => setPending(null)} disabled={saving}>Voltar</button><button className={needsCancelReason ? 'danger' : 'primary'} onClick={() => void execute()} disabled={saving || (needsCancelReason && cancelReason.trim().length < 3) || cashInvalid}>{saving ? 'Atualizando...' : 'Confirmar'}</button></footer>
          </section>
        </div>
      )}
    </div>
  );
}

function Neighborhoods() {
  const [items, setItems] = useState<NeighborhoodAdmin[]>([]);
  const [editing, setEditing] = useState<NeighborhoodAdmin | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/delivery/bairros/');
      setItems(normalizeCollection(data).map(value => {
        const item = record(value);
        return {
          id: text(item.id),
          name: text(item.nome ?? item.name),
          fee: numeric(item.taxa_entrega ?? item.delivery_fee),
          active: truthy(item.ativo ?? item.active, true),
        };
      }));
    } catch (error) { toast.error(apiMessage(error, 'Nao foi possivel carregar os bairros.')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="card delivery-admin-card">
      <header><div><h2>Bairros e taxas</h2><p>Defina onde a Bella Fornada entrega e o valor cobrado.</p></div><button className="btn btn-primary" onClick={() => setEditing({ id: '', name: '', fee: 0, active: true })}>Novo bairro</button></header>
      {loading ? <div className="delivery-empty">Carregando bairros...</div> : (
        <div className="delivery-neighborhood-list">{items.map(item => <button key={item.id} onClick={() => setEditing(item)}><span><strong>{item.name}</strong><small>{item.active ? 'Ativo' : 'Inativo'}</small></span><b>{money(item.fee)}</b><ChevronRight /></button>)}</div>
      )}
      {editing && <NeighborhoodForm item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
    </section>
  );
}

function NeighborhoodForm({ item, onClose, onSaved }: { item: NeighborhoodAdmin; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(item);
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      const payload = { nome: form.name.trim(), taxa_entrega: form.fee.toFixed(2), ativo: form.active };
      if (form.id) await api.patch(`/delivery/bairros/${form.id}/`, payload); else await api.post('/delivery/bairros/', payload);
      toast.success('Bairro salvo.'); onSaved();
    } catch (error) { toast.error(apiMessage(error, 'Nao foi possivel salvar o bairro.')); }
    finally { setSaving(false); }
  };
  return <div className="delivery-form-overlay"><form className="delivery-admin-form" onSubmit={submit}><header><h2>{item.id ? 'Editar bairro' : 'Novo bairro'}</h2><button type="button" onClick={onClose}><X /></button></header><label>Nome<input autoFocus value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} required /></label><label>Taxa de entrega<input type="number" min="0" step="0.01" value={form.fee} onChange={event => setForm(current => ({ ...current, fee: Number(event.target.value) }))} required /></label><label className="delivery-check"><input type="checkbox" checked={form.active} onChange={event => setForm(current => ({ ...current, active: event.target.checked }))} /> Bairro ativo no cardapio</label><footer><button type="button" onClick={onClose}>Cancelar</button><button className="primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar bairro'}</button></footer></form></div>;
}

function Configuration() {
  const [form, setForm] = useState<DeliveryConfiguration>(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/delivery/configuracao/').then(({ data }) => {
      const source = record(data);
      setForm({
        id: text(source.id),
        acceptingOrders: truthy(source.aceita_pedidos, true),
        whatsapp: text(source.whatsapp ?? source.whatsapp_number),
        pixKey: text(source.pix_chave),
        pixHolder: text(source.pix_beneficiario),
        pickupMinutes: numeric(source.tempo_retirada_minutos, 30),
        deliveryMinutes: numeric(source.tempo_entrega_minutos, 50),
      });
    }).catch(error => toast.error(apiMessage(error, 'Nao foi possivel carregar a configuracao.'))).finally(() => setLoading(false));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    const payload = { aceita_pedidos: form.acceptingOrders, whatsapp: form.whatsapp, pix_chave: form.pixKey, pix_beneficiario: form.pixHolder, tempo_retirada_minutos: form.pickupMinutes, tempo_entrega_minutos: form.deliveryMinutes };
    try {
      await api.patch('/delivery/configuracao/', payload);
      toast.success('Configuracao do delivery salva.');
    } catch (error) { toast.error(apiMessage(error, 'Nao foi possivel salvar a configuracao.')); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="delivery-empty">Carregando configuracao...</div>;
  return <form className="card delivery-config" onSubmit={submit}><header><div><h2>Configuracao do cardapio</h2><p>Dados vistos pelo cliente durante o pedido.</p></div><button className="btn btn-primary" disabled={saving}><Save /> {saving ? 'Salvando...' : 'Salvar'}</button></header><label className={`delivery-store-toggle ${form.acceptingOrders ? 'open' : ''}`}><input type="checkbox" checked={form.acceptingOrders} onChange={event => setForm(current => ({ ...current, acceptingOrders: event.target.checked }))} /><span>{form.acceptingOrders ? 'Cardapio aberto para novos pedidos' : 'Cardapio fechado para novos pedidos'}</span></label><div className="delivery-config-grid"><label>WhatsApp<input value={form.whatsapp} onChange={event => setForm(current => ({ ...current, whatsapp: event.target.value }))} /></label><label>Chave Pix<input value={form.pixKey} onChange={event => setForm(current => ({ ...current, pixKey: event.target.value }))} /></label><label>Beneficiario Pix<input value={form.pixHolder} onChange={event => setForm(current => ({ ...current, pixHolder: event.target.value }))} /></label><label>Tempo de retirada (min)<input type="number" min="1" value={form.pickupMinutes} onChange={event => setForm(current => ({ ...current, pickupMinutes: Number(event.target.value) }))} /></label><label>Tempo de entrega (min)<input type="number" min="1" value={form.deliveryMinutes} onChange={event => setForm(current => ({ ...current, deliveryMinutes: Number(event.target.value) }))} /></label></div></form>;
}

function apiMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.message : fallback;
  const data = record(error.response?.data);
  const candidate = data.detail ?? data.erro ?? data.error ?? data.message;
  if (typeof candidate === 'string') return candidate;
  return fallback;
}
