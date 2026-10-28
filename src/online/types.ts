export type Identifier = string | number;

export type MenuOption = {
  id: Identifier;
  name: string;
  price: number;
  available: boolean;
};

export type OptionGroup = {
  id: Identifier;
  name: string;
  minChoices: number;
  maxChoices: number;
  options: MenuOption[];
};

export type MenuProduct = {
  id: Identifier;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  available: boolean;
  optionGroups: OptionGroup[];
};

export type MenuCategory = {
  id: Identifier;
  name: string;
  products: MenuProduct[];
};

export type Neighborhood = {
  id: Identifier;
  name: string;
  fee: number;
  estimatedMinutes: number | null;
  active: boolean;
};

export type DeliverySettings = {
  storeName: string;
  whatsapp: string;
  pixKey: string;
  pixHolder: string;
  acceptingOrders: boolean;
  openNow: boolean;
  pickupMinutes: number;
  deliveryMinutes: number;
  minimumOrder: number;
};

export type PublicMenu = {
  settings: DeliverySettings;
  categories: MenuCategory[];
  neighborhoods: Neighborhood[];
};

export type CartLine = {
  key: string;
  product: MenuProduct;
  options: MenuOption[];
  quantity: number;
  notes: string;
};

export type Fulfillment = 'ENTREGA' | 'RETIRADA';
export type PaymentMethod = 'PIX' | 'DINHEIRO' | 'CARTAO';

export type CheckoutForm = {
  customerName: string;
  customerPhone: string;
  fulfillment: Fulfillment;
  neighborhoodId: string;
  cep: string;
  address: string;
  number: string;
  complement: string;
  reference: string;
  city: string;
  state: string;
  paymentMethod: PaymentMethod;
  changeFor: string;
  notes: string;
};

export type OrderItem = {
  id: Identifier;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  notes: string;
  options: Array<{ groupName: string; optionName: string; price: number }>;
};

export type DeliveryOrder = {
  id: Identifier;
  token: string;
  status: string;
  statusLabel: string;
  fulfillment: Fulfillment;
  fulfillmentLabel: string;
  paymentMethod: PaymentMethod;
  paymentConfirmed: boolean;
  customerName: string;
  customerPhone: string;
  neighborhoodName: string;
  cep: string;
  address: string;
  number: string;
  complement: string;
  reference: string;
  city: string;
  state: string;
  changeFor: number | null;
  notes: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  createdAt: string;
  items: OrderItem[];
  whatsappUrl: string;
  trackingUrl: string;
  pixKey: string;
  pixHolder: string;
  courierName: string;
};
