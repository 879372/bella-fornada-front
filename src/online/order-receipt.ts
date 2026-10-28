import type { DeliveryOrder } from './types';

const AUTO_PRINT_KEY = 'bella_fornada_delivery_auto_print';

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const money = (value: number) => value.toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const row = (label: string, value: string, strong = false) =>
  `<div class="receipt-row${strong ? ' strong' : ''}"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;

export function isAutoPrintEnabled(): boolean {
  return localStorage.getItem(AUTO_PRINT_KEY) === 'true';
}

export function setAutoPrintEnabled(enabled: boolean): void {
  localStorage.setItem(AUTO_PRINT_KEY, String(enabled));
}

export function buildOrderReceiptHtml(order: DeliveryOrder): string {
  const delivery = order.fulfillment === 'ENTREGA';
  const items = order.items.map(item => {
    const options = item.options.length
      ? `<div class="receipt-detail">${escapeHtml(item.options.map(option => option.optionName).join(', '))}</div>`
      : '';
    const notes = item.notes ? `<div class="receipt-detail">Obs.: ${escapeHtml(item.notes)}</div>` : '';
    return `<div class="receipt-item"><div><b>${item.quantity}x ${escapeHtml(item.productName)}</b><span>${escapeHtml(money(item.subtotal))}</span></div>${options}${notes}</div>`;
  }).join('');

  const address = delivery
    ? `<section><b>ENTREGA</b><div>${escapeHtml(`${order.address}, ${order.number}`)}</div><div>${escapeHtml([order.complement, order.neighborhoodName].filter(Boolean).join(' - '))}</div><div>${escapeHtml(`${order.city}/${order.state} CEP ${order.cep}`)}</div>${order.reference ? `<div>Ref.: ${escapeHtml(order.reference)}</div>` : ''}</section>`
    : '<section><b>RETIRADA NA LOJA</b></section>';

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Pedido ${escapeHtml(order.id)}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; color: #000; background: #fff; }
    body { width: 72mm; padding: 3mm 2mm 8mm; font: 700 10px/1.35 Arial, sans-serif; }
    header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 7px; }
    header h1 { margin: 2px 0; font-size: 19px; }
    header span { font-size: 13px; }
    section { padding: 7px 0; border-bottom: 1px dashed #000; }
    .receipt-item { padding: 6px 0; border-bottom: 1px dotted #444; }
    .receipt-item > div:first-child, .receipt-row { display: flex; justify-content: space-between; gap: 8px; }
    .receipt-detail { padding-left: 12px; font-size: 9px; font-weight: 600; }
    .receipt-row { padding: 2px 0; }
    .receipt-row.strong { margin-top: 4px; padding-top: 5px; border-top: 2px solid #000; font-size: 14px; }
    footer { padding-top: 8px; text-align: center; font-size: 9px; }
  </style>
</head>
<body>
  <header><div>BELLA FORNADA</div><h1>PEDIDO #${escapeHtml(order.id)}</h1><span>${delivery ? 'ENTREGA' : 'RETIRADA'}</span></header>
  <section><div><b>${escapeHtml(order.customerName)}</b></div><div>${escapeHtml(order.customerPhone)}</div><div>${escapeHtml(new Date(order.createdAt).toLocaleString('pt-BR'))}</div></section>
  <section>${items}</section>
  <section>${row('Subtotal', money(order.subtotal))}${row('Taxa de entrega', money(order.deliveryFee))}${row('TOTAL', money(order.total), true)}</section>
  <section><b>PAGAMENTO: ${escapeHtml(order.paymentMethod)}</b>${order.changeFor ? `<div>Troco para ${escapeHtml(money(order.changeFor))}</div>` : ''}</section>
  ${address}
  ${order.notes ? `<section><b>OBSERVACOES</b><div>${escapeHtml(order.notes)}</div></section>` : ''}
  <footer>Impresso em ${escapeHtml(new Date().toLocaleString('pt-BR'))}</footer>
</body>
</html>`;
}

export function printDeliveryOrder(order: DeliveryOrder): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    iframe.onload = () => {
      const target = iframe.contentWindow;
      if (!target) {
        iframe.remove();
        reject(new Error('Nao foi possivel preparar a impressao.'));
        return;
      }
      target.addEventListener('afterprint', () => iframe.remove(), { once: true });
      target.focus();
      target.print();
      window.setTimeout(() => iframe.isConnected && iframe.remove(), 60_000);
      resolve();
    };
    iframe.srcdoc = buildOrderReceiptHtml(order);
    document.body.appendChild(iframe);
  });
}
