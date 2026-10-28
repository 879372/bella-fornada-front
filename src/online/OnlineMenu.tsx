import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Banknote,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  CreditCard,
  Minus,
  Plus,
  QrCode,
  ShoppingBag,
  Store,
  Truck,
  X,
} from 'lucide-react';
import { publicApiError, publicRequestWithFallback } from '../lib/publicApi';
import { normalizeMenu, normalizeOrder } from './normalizers';
import type {
  CartLine,
  CheckoutForm,
  DeliveryOrder,
  MenuOption,
  MenuProduct,
  OptionGroup,
  PaymentMethod,
  PublicMenu,
} from './types';
import './online.css';

const COMPANY_SLUG = 'bella-fornada';
const CART_STORAGE_KEY = 'bella_fornada_delivery_cart_v1';
const OTHER_NEIGHBORHOOD = 'OUTRO';

const initialForm: CheckoutForm = {
  customerName: '',
  customerPhone: '',
  fulfillment: 'ENTREGA',
  neighborhoodId: '',
  cep: '',
  address: '',
  number: '',
  complement: '',
  reference: '',
  city: 'Fortaleza',
  state: 'CE',
  paymentMethod: 'PIX',
  changeFor: '',
  notes: '',
};

const currency = (value: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
}).format(value || 0);

const onlyDigits = (value: string) => value.replace(/\D/g, '');

const formatPhone = (value: string) => {
  const digits = onlyDigits(value).replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : '';
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

const formatCep = (value: string) => {
  const digits = onlyDigits(value).slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
};

const priceFor = (line: Pick<CartLine, 'product' | 'options'>) =>
  line.product.price + line.options.reduce((total, option) => total + option.price, 0);

const makeLineKey = (product: MenuProduct, options: MenuOption[], notes: string) =>
  [product.id, ...options.map(option => option.id).sort(), notes.trim().toLowerCase()].join(':');

function restoreCart(): CartLine[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((line): line is CartLine => {
      if (typeof line !== 'object' || line === null) return false;
      const candidate = line as Partial<CartLine>;
      return typeof candidate.key === 'string'
        && typeof candidate.quantity === 'number'
        && typeof candidate.product === 'object'
        && Array.isArray(candidate.options);
    });
  } catch {
    return [];
  }
}

function paymentLabel(method: PaymentMethod) {
  return { PIX: 'Pix', DINHEIRO: 'Dinheiro', CARTAO: 'Cartao na entrega' }[method];
}

export default function OnlineMenu({ companySlug = COMPANY_SLUG }: { companySlug?: string }) {
  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [cart, setCart] = useState<CartLine[]>(restoreCart);
  const [building, setBuilding] = useState<MenuProduct | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [result, setResult] = useState<DeliveryOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    if (!building && !checkoutOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [building, checkoutOpen]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const raw = await publicRequestWithFallback<unknown>(
          { url: `/public/${companySlug}/menu/`, method: 'GET' },
          { url: '/delivery/menu/', method: 'GET' },
        );
        if (!active) return;
        const normalized = normalizeMenu(raw);
        setMenu(normalized);
        setCart(current => reconcileCart(current, normalized));
        setError('');
      } catch (requestError) {
        if (active) setError(publicApiError(requestError, 'Nao foi possivel carregar o cardapio.'));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [companySlug]);

  const count = cart.reduce((total, line) => total + line.quantity, 0);
  const subtotal = cart.reduce((total, line) => total + priceFor(line) * line.quantity, 0);

  const addLine = (product: MenuProduct, options: MenuOption[], quantity: number, notes: string) => {
    const key = makeLineKey(product, options, notes);
    setCart(current => {
      const existing = current.find(line => line.key === key);
      if (!existing) return [...current, { key, product, options, quantity, notes: notes.trim() }];
      return current.map(line => line.key === key ? { ...line, quantity: line.quantity + quantity } : line);
    });
  };

  const changeQuantity = (key: string, amount: number) => {
    setCart(current => current
      .map(line => line.key === key ? { ...line, quantity: Math.min(99, line.quantity + amount) } : line)
      .filter(line => line.quantity > 0));
  };

  if (loading && !menu) return <PublicState message="Abrindo o cardapio da Bella Fornada..." />;
  if (!menu) return <PublicState message={error || 'Cardapio indisponivel no momento.'} error />;
  if (result) {
    return <OrderSuccess order={result} menu={menu} onNewOrder={() => {
      setCart([]);
      setResult(null);
    }} />;
  }

  const isOpen = menu.settings.acceptingOrders && menu.settings.openNow;
  return (
    <div className="bf-online">
      <header className="bf-online-header">
        <div className="bf-brand">
          <img src="/bella-fornada-logo.png" alt="Bella Fornada" />
          <span><strong>{menu.settings.storeName}</strong><small>Padaria & delivery</small></span>
        </div>
        <span className={`bf-store-state ${isOpen ? 'is-open' : ''}`}>
          <i /> {isOpen ? 'Aceitando pedidos' : 'Pedidos fechados'}
        </span>
      </header>

      <section className="bf-online-hero">
        <div>
          <span>Direto do forno para voce</span>
          <h1>Seu pedido, do seu jeito.</h1>
          <p>Escolha os produtos, personalize os complementos e receba em casa ou retire na padaria.</p>
          <div className="bf-hero-times">
            <span><Store /> Retirada ~{menu.settings.pickupMinutes} min</span>
            <span><Truck /> Entrega ~{menu.settings.deliveryMinutes} min</span>
          </div>
        </div>
        <img src="/bella-fornada-logo.png" alt="" aria-hidden="true" />
      </section>

      <nav className="bf-category-nav" aria-label="Categorias do cardapio">
        {menu.categories.map(category => (
          <button key={category.id} onClick={() => document.getElementById(`bf-category-${category.id}`)?.scrollIntoView({ behavior: 'smooth' })}>
            {category.name}
          </button>
        ))}
      </nav>

      {error && <div className="bf-public-alert error">{error}</div>}
      <main className="bf-menu-content">
        {menu.categories.map(category => (
          <section className="bf-menu-section" id={`bf-category-${category.id}`} key={category.id}>
            <header><span>Categoria</span><h2>{category.name}</h2></header>
            <div className="bf-product-grid">
              {category.products.map(product => {
                const inCart = cart.filter(line => String(line.product.id) === String(product.id))
                  .reduce((total, line) => total + line.quantity, 0);
                const customizable = product.optionGroups.length > 0;
                const simpleLine = cart.find(line => line.key === makeLineKey(product, [], ''));
                return (
                  <article className={inCart ? 'has-items' : ''} key={product.id}>
                    {product.imageUrl && <img className="bf-product-image" src={product.imageUrl} alt="" loading="lazy" />}
                    <div className="bf-product-copy">
                      <h3>{product.name}</h3>
                      <p>{product.description || (customizable ? 'Escolha seus complementos.' : 'Preparado com carinho pela Bella Fornada.')}</p>
                      <strong>{customizable ? 'A partir de ' : ''}{currency(product.price)}</strong>
                    </div>
                    {customizable ? (
                      <div className="bf-build-action">
                        <button onClick={() => setBuilding(product)}><Plus /> {inCart ? 'Montar outro' : 'Montar'}</button>
                        {inCart > 0 && <small>{inCart} no carrinho</small>}
                      </div>
                    ) : (
                      <QuantityControl
                        label={product.name}
                        quantity={simpleLine?.quantity || 0}
                        onLess={() => simpleLine && changeQuantity(simpleLine.key, -1)}
                        onMore={() => addLine(product, [], 1, '')}
                      />
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </main>

      {count > 0 && (
        <button className="bf-cart-bar" onClick={() => setCheckoutOpen(true)}>
          <span className="bf-cart-count"><ShoppingBag /><b>{count}</b></span>
          <span><small>{count === 1 ? '1 item' : `${count} itens`}</small><strong>{currency(subtotal)}</strong></span>
          <em>Finalizar <ChevronRight /></em>
        </button>
      )}

      {building && (
        <OptionsModal
          product={building}
          onClose={() => setBuilding(null)}
          onAdd={(options, quantity, notes) => {
            addLine(building, options, quantity, notes);
            setBuilding(null);
          }}
        />
      )}

      {checkoutOpen && cart.length > 0 && (
        <Checkout
          companySlug={companySlug}
          menu={menu}
          cart={cart}
          subtotal={subtotal}
          onChangeQuantity={changeQuantity}
          onClose={() => setCheckoutOpen(false)}
          onSuccess={order => {
            localStorage.removeItem(CART_STORAGE_KEY);
            setResult(order);
            setCheckoutOpen(false);
          }}
        />
      )}
    </div>
  );
}

function reconcileCart(cart: CartLine[], menu: PublicMenu): CartLine[] {
  const products = new Map(menu.categories.flatMap(category => category.products).map(product => [String(product.id), product]));
  return cart.flatMap(line => {
    const product = products.get(String(line.product.id));
    if (!product) return [];
    const options = line.options.flatMap(stored => {
      const current = product.optionGroups.flatMap(group => group.options).find(item => String(item.id) === String(stored.id));
      return current ? [current] : [];
    });
    return [{ ...line, product, options, key: makeLineKey(product, options, line.notes) }];
  });
}

function QuantityControl({ label, quantity, onLess, onMore }: {
  label: string;
  quantity: number;
  onLess: () => void;
  onMore: () => void;
}) {
  return (
    <div className="bf-quantity">
      <button type="button" aria-label={`Remover ${label}`} disabled={!quantity} onClick={onLess}><Minus /></button>
      <b>{quantity}</b>
      <button type="button" aria-label={`Adicionar ${label}`} onClick={onMore}><Plus /></button>
    </div>
  );
}

function OptionsModal({ product, onClose, onAdd }: {
  product: MenuProduct;
  onClose: () => void;
  onAdd: (options: MenuOption[], quantity: number, notes: string) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');

  const chosen = product.optionGroups.flatMap(group => group.options.filter(item => selected[String(group.id)]?.includes(String(item.id))));
  const missing = product.optionGroups.find(group => (selected[String(group.id)]?.length || 0) < group.minChoices);
  const total = (product.price + chosen.reduce((sum, item) => sum + item.price, 0)) * quantity;

  const toggle = (group: OptionGroup, option: MenuOption) => {
    const groupId = String(group.id);
    const optionId = String(option.id);
    setSelected(current => {
      const selectedIds = current[groupId] || [];
      if (selectedIds.includes(optionId)) return { ...current, [groupId]: selectedIds.filter(id => id !== optionId) };
      if (group.maxChoices === 1) return { ...current, [groupId]: [optionId] };
      if (selectedIds.length >= group.maxChoices) return current;
      return { ...current, [groupId]: [...selectedIds, optionId] };
    });
  };

  return (
    <div className="bf-public-overlay">
      <section className="bf-sheet bf-options-sheet" role="dialog" aria-modal="true" aria-label={`Personalizar ${product.name}`}>
        <header className="bf-sheet-header">
          <button onClick={onClose} aria-label="Voltar"><ArrowLeft /></button>
          <div><small>Personalize</small><h2>{product.name}</h2></div>
          <button onClick={onClose} aria-label="Fechar"><X /></button>
        </header>
        <form onSubmit={event => { event.preventDefault(); if (!missing) onAdd(chosen, quantity, notes); }}>
          <div className="bf-sheet-scroll">
            {product.description && <p className="bf-product-description">{product.description}</p>}
            {product.optionGroups.map(group => {
              const ids = selected[String(group.id)] || [];
              return (
                <fieldset className="bf-option-group" key={group.id}>
                  <legend>
                    <span><strong>{group.name}</strong><small>{choiceHint(group)}</small></span>
                    <b className={ids.length >= group.minChoices ? 'done' : ''}>{ids.length}/{group.maxChoices}</b>
                  </legend>
                  {group.options.map(option => {
                    const checked = ids.includes(String(option.id));
                    const blocked = !checked && ids.length >= group.maxChoices;
                    return (
                      <label className={`${checked ? 'active' : ''} ${blocked ? 'blocked' : ''}`} key={option.id}>
                        <input
                          type={group.maxChoices === 1 ? 'radio' : 'checkbox'}
                          name={`group-${group.id}`}
                          checked={checked}
                          disabled={blocked}
                          onChange={() => toggle(group, option)}
                        />
                        <span>{option.name}</span>
                        {option.price > 0 && <strong>+ {currency(option.price)}</strong>}
                      </label>
                    );
                  })}
                </fieldset>
              );
            })}
            <label className="bf-field">Observacao do item <small>(opcional)</small>
              <textarea value={notes} maxLength={240} onChange={event => setNotes(event.target.value)} placeholder="Ex.: sem cebola, bem assado..." />
            </label>
          </div>
          <footer className="bf-sheet-footer">
            <QuantityControl label={product.name} quantity={quantity} onLess={() => setQuantity(value => Math.max(1, value - 1))} onMore={() => setQuantity(value => Math.min(99, value + 1))} />
            <button className="bf-primary-button" disabled={Boolean(missing)}>
              {missing ? `Escolha: ${missing.name}` : `Adicionar · ${currency(total)}`}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function choiceHint(group: OptionGroup) {
  if (group.minChoices === group.maxChoices) return `Escolha ${group.minChoices}`;
  if (group.minChoices) return `Escolha de ${group.minChoices} a ${group.maxChoices}`;
  return `Ate ${group.maxChoices} (opcional)`;
}

type CheckoutProps = {
  companySlug: string;
  menu: PublicMenu;
  cart: CartLine[];
  subtotal: number;
  onChangeQuantity: (key: string, amount: number) => void;
  onClose: () => void;
  onSuccess: (order: DeliveryOrder) => void;
};

function Checkout({ companySlug, menu, cart, subtotal, onChangeQuantity, onClose, onSuccess }: CheckoutProps) {
  const [form, setForm] = useState<CheckoutForm>(initialForm);
  const [otherNeighborhood, setOtherNeighborhood] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selectedNeighborhood = menu.neighborhoods.find(item => String(item.id) === form.neighborhoodId);
  const delivery = form.fulfillment === 'ENTREGA';
  const otherArea = form.neighborhoodId === OTHER_NEIGHBORHOOD;
  const deliveryFee = delivery && selectedNeighborhood ? selectedNeighborhood.fee : 0;
  const total = subtotal + deliveryFee;
  const minimumMissing = delivery && menu.settings.minimumOrder > 0 && subtotal < menu.settings.minimumOrder;
  const changeFor = Number(form.changeFor.replace(',', '.')) || 0;

  const set = <K extends keyof CheckoutForm>(key: K, value: CheckoutForm[K]) => {
    setError('');
    setForm(current => ({ ...current, [key]: value }));
  };

  const validate = () => {
    if (!form.customerName.trim()) return 'Informe seu nome.';
    if (onlyDigits(form.customerPhone).length < 10) return 'Informe um WhatsApp com DDD.';
    if (minimumMissing) return `O pedido minimo para entrega e ${currency(menu.settings.minimumOrder)}.`;
    if (delivery && !form.neighborhoodId) return 'Selecione o bairro da entrega.';
    if (delivery && otherArea && !otherNeighborhood.trim()) return 'Informe o nome do bairro.';
    if (delivery && onlyDigits(form.cep).length !== 8) return 'Informe um CEP valido.';
    if (delivery && (!form.address.trim() || !form.number.trim() || !form.city.trim() || form.state.trim().length !== 2)) return 'Complete o endereco de entrega.';
    if (form.paymentMethod === 'DINHEIRO' && changeFor > 0 && changeFor < total) return `O troco deve ser para pelo menos ${currency(total)}.`;
    return '';
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const validation = validate();
    if (validation) { setError(validation); return; }

    const idempotencyKey = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const payload = {
      nome_cliente: form.customerName.trim(),
      telefone_cliente: onlyDigits(form.customerPhone),
      fulfillment: form.fulfillment,
      payment_method: form.paymentMethod,
      bairro: delivery && !otherArea ? form.neighborhoodId : null,
      bairro_outro: delivery && otherArea ? otherNeighborhood.trim() : '',
      cep: delivery ? onlyDigits(form.cep) : '',
      endereco: delivery ? form.address.trim() : '',
      numero: delivery ? form.number.trim() : '',
      complemento: delivery ? form.complement.trim() : '',
      referencia: delivery ? form.reference.trim() : '',
      cidade: delivery ? form.city.trim() : '',
      uf: delivery ? form.state.trim().toUpperCase() : '',
      troco_para: form.paymentMethod === 'DINHEIRO' && changeFor > 0 ? changeFor.toFixed(2) : null,
      observacoes: form.notes.trim(),
      itens: cart.map(line => ({
        produto: line.product.id,
        quantidade: line.quantity,
        complementos: line.options.map(option => option.id),
        observacoes: line.notes,
      })),
    };

    setSaving(true);
    setError('');
    try {
      const raw = await publicRequestWithFallback<unknown>(
        {
          url: `/public/${companySlug}/orders/`,
          method: 'POST',
          data: payload,
          headers: { 'Idempotency-Key': idempotencyKey },
        },
        {
          url: '/delivery/pedidos/',
          method: 'POST',
          data: payload,
          headers: { 'Idempotency-Key': idempotencyKey },
        },
      );
      onSuccess(normalizeOrder(raw));
    } catch (requestError) {
      setError(publicApiError(requestError, 'Nao foi possivel enviar seu pedido.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bf-public-overlay">
      <section className="bf-sheet bf-checkout-sheet" role="dialog" aria-modal="true" aria-label="Finalizar pedido">
        <header className="bf-sheet-header">
          <button onClick={onClose} aria-label="Voltar"><ArrowLeft /></button>
          <div><small>Confira e finalize</small><h2>Seu pedido</h2></div>
          <button onClick={onClose} aria-label="Fechar"><X /></button>
        </header>
        <form onSubmit={submit}>
          <div className="bf-sheet-scroll bf-checkout-scroll">
            <CheckoutItems cart={cart} onChangeQuantity={onChangeQuantity} />

            <section className="bf-checkout-block">
              <header><span>1</span><div><h3>Seus dados</h3><small>Para confirmar e atualizar o pedido</small></div></header>
              <div className="bf-form-grid">
                <label className="bf-field wide">Nome<input autoComplete="name" value={form.customerName} onChange={event => set('customerName', event.target.value)} /></label>
                <label className="bf-field wide">WhatsApp<input inputMode="tel" autoComplete="tel" value={form.customerPhone} onChange={event => set('customerPhone', formatPhone(event.target.value))} placeholder="(85) 99999-9999" /></label>
              </div>
            </section>

            <section className="bf-checkout-block">
              <header><span>2</span><div><h3>Entrega ou retirada</h3><small>Escolha como quer receber</small></div></header>
              <div className="bf-choice-grid">
                <Choice active={!delivery} onClick={() => set('fulfillment', 'RETIRADA')} icon={<Store />} label="Retirar" detail={`~${menu.settings.pickupMinutes} min`} />
                <Choice active={delivery} onClick={() => set('fulfillment', 'ENTREGA')} icon={<Truck />} label="Entrega" detail={`~${menu.settings.deliveryMinutes} min`} />
              </div>
              {delivery ? (
                <div className="bf-form-grid">
                  <label className="bf-field wide">Bairro
                    <select value={form.neighborhoodId} onChange={event => set('neighborhoodId', event.target.value)}>
                      <option value="">Selecione o bairro</option>
                      {menu.neighborhoods.map(item => <option key={item.id} value={item.id}>{item.name} · {currency(item.fee)}</option>)}
                      <option value={OTHER_NEIGHBORHOOD}>Meu bairro nao esta na lista</option>
                    </select>
                  </label>
                  {otherArea && <label className="bf-field wide">Nome do bairro<input value={otherNeighborhood} onChange={event => setOtherNeighborhood(event.target.value)} /></label>}
                  <label className="bf-field">CEP<input inputMode="numeric" autoComplete="postal-code" value={form.cep} onChange={event => set('cep', formatCep(event.target.value))} placeholder="00000-000" /></label>
                  <label className="bf-field">Numero<input inputMode="numeric" value={form.number} onChange={event => set('number', event.target.value)} /></label>
                  <label className="bf-field wide">Rua / avenida<input autoComplete="address-line1" value={form.address} onChange={event => set('address', event.target.value)} /></label>
                  <label className="bf-field">Complemento <small>(opcional)</small><input autoComplete="address-line2" value={form.complement} onChange={event => set('complement', event.target.value)} /></label>
                  <label className="bf-field">Referencia <small>(opcional)</small><input value={form.reference} onChange={event => set('reference', event.target.value)} /></label>
                  <label className="bf-field">Cidade<input value={form.city} onChange={event => set('city', event.target.value)} /></label>
                  <label className="bf-field">UF<input maxLength={2} value={form.state} onChange={event => set('state', event.target.value.toUpperCase())} /></label>
                  {otherArea && <p className="bf-inline-note wide">A taxa do bairro sera confirmada pelo WhatsApp antes da entrega.</p>}
                </div>
              ) : <p className="bf-inline-note">Retire na Bella Fornada apos a confirmacao do pedido.</p>}
            </section>

            <section className="bf-checkout-block">
              <header><span>3</span><div><h3>Pagamento</h3><small>Escolha a forma de pagamento</small></div></header>
              <div className="bf-payment-grid">
                <Choice active={form.paymentMethod === 'PIX'} onClick={() => set('paymentMethod', 'PIX')} icon={<QrCode />} label="Pix" />
                <Choice active={form.paymentMethod === 'DINHEIRO'} onClick={() => set('paymentMethod', 'DINHEIRO')} icon={<Banknote />} label="Dinheiro" />
                <Choice active={form.paymentMethod === 'CARTAO'} onClick={() => set('paymentMethod', 'CARTAO')} icon={<CreditCard />} label="Cartao" />
              </div>
              {form.paymentMethod === 'PIX' && <p className="bf-inline-note">A chave Pix e as instrucoes aparecem depois de confirmar.</p>}
              {form.paymentMethod === 'CARTAO' && <p className="bf-inline-note">Pagamento na maquininha na entrega ou retirada.</p>}
              {form.paymentMethod === 'DINHEIRO' && (
                <label className="bf-field">Troco para <small>(deixe vazio se nao precisar)</small>
                  <input inputMode="decimal" value={form.changeFor} onChange={event => set('changeFor', event.target.value)} placeholder="Ex.: 100,00" />
                </label>
              )}
              <label className="bf-field">Observacoes do pedido <small>(opcional)</small>
                <textarea value={form.notes} maxLength={300} onChange={event => set('notes', event.target.value)} placeholder="Ex.: tocar a campainha, enviar talheres..." />
              </label>
            </section>
            {error && <div className="bf-public-alert error">{error}</div>}
          </div>
          <footer className="bf-checkout-footer">
            <div className="bf-order-totals">
              <span>Subtotal <b>{currency(subtotal)}</b></span>
              <span>Entrega <b>{!delivery ? 'Retirada' : otherArea ? 'A confirmar' : currency(deliveryFee)}</b></span>
              <strong>Total <b>{currency(total)}</b></strong>
            </div>
            <button className="bf-primary-button" disabled={saving || !menu.settings.acceptingOrders}>
              {saving ? 'Enviando pedido...' : menu.settings.acceptingOrders ? 'Confirmar pedido' : 'Pedidos fechados'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function CheckoutItems({ cart, onChangeQuantity }: { cart: CartLine[]; onChangeQuantity: (key: string, amount: number) => void }) {
  return (
    <section className="bf-checkout-items">
      <h3><ShoppingBag /> Itens do pedido</h3>
      {cart.map(line => (
        <div key={line.key}>
          <span>
            <b>{line.product.name}</b>
            {line.options.length > 0 && <small>{line.options.map(option => option.name).join(', ')}</small>}
            {line.notes && <small>Obs.: {line.notes}</small>}
          </span>
          <span><strong>{currency(priceFor(line) * line.quantity)}</strong><QuantityControl label={line.product.name} quantity={line.quantity} onLess={() => onChangeQuantity(line.key, -1)} onMore={() => onChangeQuantity(line.key, 1)} /></span>
        </div>
      ))}
    </section>
  );
}

function Choice({ active, onClick, icon, label, detail }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  detail?: string;
}) {
  return <button className={active ? 'active' : ''} type="button" onClick={onClick}>{icon}<span><b>{label}</b>{detail && <small>{detail}</small>}</span>{active && <Check />}</button>;
}

function OrderSuccess({ order, menu, onNewOrder }: { order: DeliveryOrder; menu: PublicMenu; onNewOrder: () => void }) {
  const [copied, setCopied] = useState(false);
  const trackingPath = order.trackingUrl || `/acompanhar/${order.token}`;
  const whatsappUrl = useMemo(() => {
    if (order.whatsappUrl) return order.whatsappUrl;
    const phone = onlyDigits(menu.settings.whatsapp);
    if (!phone) return '';
    const number = phone.startsWith('55') ? phone : `55${phone}`;
    const message = `Ola! Fiz o pedido #${order.id} no cardapio da Bella Fornada. Total: ${currency(order.total)}.`;
    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  }, [menu.settings.whatsapp, order]);
  const pixKey = order.pixKey || menu.settings.pixKey;
  const pixHolder = order.pixHolder || menu.settings.pixHolder;

  const copyPix = async () => {
    if (!pixKey) return;
    await navigator.clipboard?.writeText(pixKey);
    setCopied(true);
  };

  return (
    <main className="bf-order-success">
      <img src="/bella-fornada-logo.png" alt="Bella Fornada" />
      <div className="bf-success-icon"><Check /></div>
      <span>Pedido #{order.id}</span>
      <h1>Pedido recebido!</h1>
      <p>Agora acompanhe a confirmacao e o preparo em tempo real.</p>
      <section>
        <div><span>Total</span><strong>{currency(order.total)}</strong></div>
        <div><span>Pagamento</span><strong>{paymentLabel(order.paymentMethod)}</strong></div>
        {order.paymentMethod === 'PIX' && (
          <div className="bf-pix-box">
            <span>Chave Pix</span>
            <strong>{pixKey || 'A loja enviara pelo WhatsApp'}</strong>
            {pixHolder && <small>{pixHolder}</small>}
            {pixKey && <button onClick={() => void copyPix()}>{copied ? <Check /> : <Copy />} {copied ? 'Chave copiada' : 'Copiar chave Pix'}</button>}
          </div>
        )}
      </section>
      {whatsappUrl && <a className="bf-whatsapp-button" href={whatsappUrl} target="_blank" rel="noreferrer">Enviar pedido no WhatsApp</a>}
      {order.token && <a className="bf-tracking-button" href={trackingPath}>Acompanhar meu pedido</a>}
      <button className="bf-new-order" onClick={onNewOrder}>Fazer novo pedido</button>
    </main>
  );
}

function PublicState({ message, error = false }: { message: string; error?: boolean }) {
  return (
    <main className={`bf-public-state ${error ? 'error' : ''}`}>
      <img src="/bella-fornada-logo.png" alt="Bella Fornada" />
      <Clock3 />
      <p>{message}</p>
    </main>
  );
}
