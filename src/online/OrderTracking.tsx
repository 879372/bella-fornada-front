import { useEffect, useMemo, useState } from 'react';
import { Check, Clock3, MapPin, PackageCheck, RefreshCw, Truck } from 'lucide-react';
import { publicApiError, publicRequestWithFallback } from '../lib/publicApi';
import { normalizeOrder } from './normalizers';
import type { DeliveryOrder } from './types';
import './online.css';

const currency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);

const STATUS_ALIASES: Record<string, string> = {
  PENDING: 'PENDENTE',
  WAITING_PIX: 'AGUARDANDO_PIX',
  CONFIRMED: 'CONFIRMADO',
  PREPARING: 'EM_PREPARO',
  READY: 'PRONTO',
  OUT_FOR_DELIVERY: 'SAIU_ENTREGA',
  COMPLETED: 'CONCLUIDO',
  CANCELLED: 'CANCELADO',
};

const STATUS_LABELS: Record<string, string> = {
  PENDENTE: 'Pedido recebido',
  AGUARDANDO_PIX: 'Aguardando Pix',
  CONFIRMADO: 'Pedido confirmado',
  EM_PREPARO: 'Em preparacao',
  PRONTO: 'Pedido pronto',
  SAIU_ENTREGA: 'Saiu para entrega',
  CONCLUIDO: 'Pedido concluido',
  CANCELADO: 'Pedido cancelado',
};

export default function OrderTracking({ token }: { token: string }) {
  const [order, setOrder] = useState<DeliveryOrder | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const raw = await publicRequestWithFallback<unknown>(
        { url: `/public/orders/${token}/`, method: 'GET' },
        { url: `/delivery/pedidos/rastrear/${token}/`, method: 'GET' },
      );
      setOrder(normalizeOrder(raw));
      setError('');
    } catch (requestError) {
      setError(publicApiError(requestError, 'Nao foi possivel localizar este pedido.'));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 45_000);
    return () => window.clearInterval(timer);
  // A funcao usa somente o token da rota e setters estaveis.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const status = STATUS_ALIASES[order?.status || ''] || order?.status || 'PENDENTE';
  const steps = useMemo(() => order?.fulfillment === 'ENTREGA'
    ? ['PENDENTE', 'CONFIRMADO', 'EM_PREPARO', 'PRONTO', 'SAIU_ENTREGA', 'CONCLUIDO']
    : ['PENDENTE', 'CONFIRMADO', 'EM_PREPARO', 'PRONTO', 'CONCLUIDO'], [order?.fulfillment]);
  const current = steps.indexOf(status);

  if (!order) {
    return <main className={`bf-public-state ${error ? 'error' : ''}`}><img src="/bella-fornada-logo.png" alt="Bella Fornada" /><Clock3 /><p>{error || 'Buscando seu pedido...'}</p></main>;
  }

  return (
    <main className="bf-tracking-page">
      <header>
        <img src="/bella-fornada-logo.png" alt="Bella Fornada" />
        <button onClick={() => void load()} disabled={refreshing}><RefreshCw className={refreshing ? 'spin' : ''} /> Atualizar</button>
      </header>
      <section className="bf-tracking-hero">
        <span>Pedido #{order.id}</span>
        <div className="bf-tracking-icon">{status === 'SAIU_ENTREGA' ? <Truck /> : status === 'CONCLUIDO' ? <PackageCheck /> : <Clock3 />}</div>
        <h1>{order.statusLabel || STATUS_LABELS[status] || status}</h1>
        <p>Esta pagina atualiza automaticamente enquanto seu pedido avanca.</p>
      </section>

      {status === 'CANCELADO' ? <div className="bf-public-alert error">Este pedido foi cancelado. Fale com a loja se precisar de ajuda.</div> : (
        <section className="bf-tracking-steps" aria-label="Andamento do pedido">
          {steps.map((step, index) => (
            <div className={index < current ? 'done' : index === current ? 'current' : ''} key={step}>
              <i>{index <= current ? <Check /> : index + 1}</i>
              <span>{STATUS_LABELS[step]}</span>
            </div>
          ))}
        </section>
      )}

      <div className="bf-tracking-grid">
        <section className="bf-tracking-card">
          <h2>Resumo do pedido</h2>
          {order.items.map(item => (
            <div className="bf-tracking-item" key={item.id}>
              <span><b>{item.quantity}x {item.productName}</b>{item.options.length > 0 && <small>{item.options.map(option => option.optionName).join(', ')}</small>}{item.notes && <small>Obs.: {item.notes}</small>}</span>
              <strong>{currency(item.subtotal)}</strong>
            </div>
          ))}
          <div className="bf-tracking-total"><span>Total</span><strong>{currency(order.total)}</strong></div>
        </section>
        <aside className="bf-tracking-card">
          <h2>{order.fulfillmentLabel}</h2>
          {order.fulfillment === 'ENTREGA' ? <p><MapPin /> <span>{order.address}, {order.number}{order.complement && ` · ${order.complement}`}<br />{order.neighborhoodName}, {order.city}/{order.state}</span></p> : <p><PackageCheck /> <span>Retirada na Bella Fornada.</span></p>}
          {order.courierName && <p><Truck /> <span>Entregador: {order.courierName}</span></p>}
        </aside>
      </div>
    </main>
  );
}
