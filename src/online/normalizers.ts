import type {
  DeliveryOrder,
  DeliverySettings,
  MenuCategory,
  MenuOption,
  MenuProduct,
  Neighborhood,
  OptionGroup,
  PaymentMethod,
  PublicMenu,
} from './types';

export type UnknownRecord = Record<string, unknown>;

export const record = (value: unknown): UnknownRecord =>
  typeof value === 'object' && value !== null ? value as UnknownRecord : {};

export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export const first = (source: UnknownRecord, keys: string[]): unknown => {
  for (const key of keys) if (source[key] !== undefined && source[key] !== null) return source[key];
  return undefined;
};

export const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;

export const numeric = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const truthy = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true' || value === 'sim') return true;
  if (value === 0 || value === '0' || value === 'false' || value === 'nao') return false;
  return fallback;
};

const option = (value: unknown): MenuOption => {
  const source = record(value);
  return {
    id: text(first(source, ['id', 'uuid', 'codigo'])),
    name: text(first(source, ['name', 'nome', 'descricao'])),
    price: numeric(first(source, ['price', 'preco', 'valor_adicional', 'preco_adicional'])),
    available: truthy(first(source, ['available', 'disponivel', 'ativo']), true),
  };
};

const optionGroup = (value: unknown): OptionGroup => {
  const source = record(value);
  const options = list(first(source, ['options', 'opcoes', 'complementos'])).map(option).filter(item => item.available);
  const maxChoices = Math.max(1, numeric(first(source, ['max_choices', 'max_escolhas', 'quantidade_maxima']), 1));
  return {
    id: text(first(source, ['id', 'uuid', 'codigo'])),
    name: text(first(source, ['name', 'nome', 'titulo']), 'Complementos'),
    minChoices: Math.max(0, numeric(first(source, ['min_choices', 'min_escolhas', 'quantidade_minima']))),
    maxChoices,
    options,
  };
};

const product = (value: unknown): MenuProduct => {
  const source = record(value);
  return {
    id: text(first(source, ['id', 'uuid', 'produto_id', 'codigo'])),
    name: text(first(source, ['name', 'nome', 'descricao']), 'Produto'),
    description: text(first(source, ['description', 'descricao_cardapio', 'descricao', 'detalhes'])),
    price: numeric(first(source, ['price', 'preco', 'preco_venda', 'valor'])),
    imageUrl: text(first(source, ['image_url', 'imagem_url', 'imagem', 'foto'])),
    available: truthy(first(source, ['available', 'disponivel', 'ativo']), true),
    optionGroups: list(first(source, ['option_groups', 'grupos_complementos', 'grupos', 'complement_groups']))
      .map(optionGroup)
      .filter(group => group.options.length > 0),
  };
};

const category = (value: unknown, index: number): MenuCategory => {
  const source = record(value);
  return {
    id: text(first(source, ['id', 'uuid', 'grupo_id', 'codigo']), String(index + 1)),
    name: text(first(source, ['name', 'nome', 'titulo']), 'Produtos'),
    products: list(first(source, ['products', 'produtos', 'itens'])).map(product).filter(item => item.available),
  };
};

const neighborhood = (value: unknown): Neighborhood => {
  const source = record(value);
  const estimate = first(source, ['estimated_minutes', 'tempo_estimado', 'prazo_minutos']);
  return {
    id: text(first(source, ['id', 'uuid', 'codigo'])),
    name: text(first(source, ['name', 'nome', 'bairro'])),
    fee: numeric(first(source, ['delivery_fee', 'taxa_entrega', 'taxa', 'valor'])),
    estimatedMinutes: estimate === undefined ? null : numeric(estimate),
    active: truthy(first(source, ['active', 'ativo']), true),
  };
};

const settings = (value: unknown, company: UnknownRecord): DeliverySettings => {
  const source = record(value);
  return {
    storeName: text(first(company, ['name', 'nome', 'razao_social']), text(first(source, ['store_name', 'nome_loja']), 'Bella Fornada')),
    whatsapp: text(first(source, ['whatsapp_number', 'whatsapp', 'telefone_whatsapp'])),
    pixKey: text(first(source, ['pix_key', 'chave_pix'])),
    pixHolder: text(first(source, ['pix_holder', 'titular_pix', 'favorecido_pix'])),
    acceptingOrders: truthy(first(source, ['is_accepting_orders', 'aceitando_pedidos', 'pedidos_ativos']), true),
    openNow: truthy(first(source, ['is_open_now', 'aberto_agora', 'esta_aberto']), true),
    pickupMinutes: numeric(first(source, ['pickup_minutes', 'tempo_retirada', 'retirada_minutos']), 25),
    deliveryMinutes: numeric(first(source, ['delivery_minutes', 'tempo_entrega', 'entrega_minutos']), 50),
    minimumOrder: numeric(first(source, ['minimum_order', 'pedido_minimo', 'valor_minimo'])),
  };
};

export function normalizeMenu(value: unknown): PublicMenu {
  const source = record(value);
  const company = record(first(source, ['company', 'empresa', 'loja']));
  const configuration = first(source, ['settings', 'configuracao', 'configuration']) ?? source;
  const rawCategories = list(first(source, ['categories', 'categorias', 'grupos']));
  let categories = rawCategories.map(category).filter(item => item.products.length > 0);

  if (!categories.length) {
    const products = list(first(source, ['products', 'produtos', 'itens'])).map(product).filter(item => item.available);
    categories = [{ id: 'todos', name: 'Produtos', products }];
  }

  return {
    settings: settings(configuration, company),
    categories,
    neighborhoods: list(first(source, ['neighborhoods', 'bairros', 'delivery_areas']))
      .map(neighborhood)
      .filter(item => item.active),
  };
}

const normalizePayment = (value: unknown): PaymentMethod => {
  const normalized = text(value).toUpperCase();
  if (normalized === 'CASH' || normalized === 'DINHEIRO') return 'DINHEIRO';
  if (normalized === 'CARD' || normalized === 'CARTAO' || normalized === 'CARTÃO') return 'CARTAO';
  return 'PIX';
};

export function normalizeOrder(value: unknown): DeliveryOrder {
  const source = record(value);
  const rawItems = list(first(source, ['items', 'itens']));
  const fulfillmentRaw = text(first(source, ['fulfillment', 'tipo_entrega', 'modalidade'])).toUpperCase();
  const fulfillment = fulfillmentRaw === 'DELIVERY' || fulfillmentRaw === 'ENTREGA' ? 'ENTREGA' : 'RETIRADA';
  const token = text(first(source, ['tracking_token', 'public_token', 'token_publico', 'token', 'uuid']));
  return {
    id: text(first(source, ['id', 'numero', 'codigo'])),
    token,
    status: text(first(source, ['status', 'situacao']), 'PENDENTE').toUpperCase(),
    statusLabel: text(first(source, ['status_label', 'status_display', 'situacao_label'])),
    fulfillment,
    fulfillmentLabel: text(first(source, ['fulfillment_label', 'fulfillment_display', 'tipo_entrega_display']), fulfillment === 'ENTREGA' ? 'Entrega' : 'Retirada'),
    paymentMethod: normalizePayment(first(source, ['payment_method', 'forma_pagamento'])),
    paymentConfirmed: truthy(first(source, ['payment_confirmed', 'pagamento_confirmado', 'pago'])),
    customerName: text(first(source, ['customer_name', 'cliente_nome', 'nome_cliente'])),
    customerPhone: text(first(source, ['customer_phone', 'cliente_telefone', 'telefone_cliente', 'whatsapp'])),
    neighborhoodName: text(first(source, ['neighborhood_name', 'bairro_nome', 'bairro'])),
    cep: text(first(source, ['cep', 'codigo_postal'])),
    address: text(first(source, ['address', 'endereco'])),
    number: text(first(source, ['number', 'numero'])),
    complement: text(first(source, ['complement', 'complemento'])),
    reference: text(first(source, ['reference', 'referencia'])),
    city: text(first(source, ['city', 'cidade'])),
    state: text(first(source, ['state', 'uf'])),
    changeFor: first(source, ['change_for', 'troco_para']) == null ? null : numeric(first(source, ['change_for', 'troco_para'])),
    notes: text(first(source, ['notes', 'observacoes', 'observacao'])),
    subtotal: numeric(first(source, ['subtotal', 'valor_produtos'])),
    deliveryFee: numeric(first(source, ['delivery_fee', 'taxa_entrega'])),
    total: numeric(first(source, ['total', 'valor_total'])),
    createdAt: text(first(source, ['created_at', 'criado_em', 'data'])),
    items: rawItems.map((itemValue, index) => {
      const item = record(itemValue);
      const productSource = record(first(item, ['product', 'produto']));
      const rawOptions = list(first(item, ['options', 'opcoes', 'complementos']));
      return {
        id: text(first(item, ['id', 'uuid']), String(index + 1)),
        productName: text(first(item, ['product_name', 'produto_nome', 'nome']), text(first(productSource, ['name', 'nome', 'descricao']))),
        quantity: numeric(first(item, ['quantity', 'quantidade']), 1),
        unitPrice: numeric(first(item, ['unit_price', 'preco_unitario', 'valor_unitario'])),
        subtotal: numeric(first(item, ['subtotal', 'total', 'valor_total'])),
        notes: text(first(item, ['notes', 'observacoes', 'observacao'])),
        options: rawOptions.map(optionValue => {
          const optionSource = record(optionValue);
          return {
            groupName: text(first(optionSource, ['group_name', 'grupo_nome', 'grupo'])),
            optionName: text(first(optionSource, ['option_name', 'complemento_nome', 'name', 'nome'])),
            price: numeric(first(optionSource, ['price', 'preco', 'valor_adicional'])),
          };
        }),
      };
    }),
    whatsappUrl: text(first(source, ['whatsapp_url', 'url_whatsapp'])),
    trackingUrl: text(first(source, ['tracking_url', 'url_rastreio'])),
    pixKey: text(first(source, ['pix_key', 'chave_pix', 'pix_chave'])),
    pixHolder: text(first(source, ['pix_holder', 'titular_pix', 'pix_beneficiario'])),
    courierName: text(first(source, ['courier_name', 'entregador_nome', 'entregador'])),
  };
}

export function normalizeCollection(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const source = record(value);
  return list(first(source, ['results', 'resultados', 'items', 'itens', 'data']));
}
