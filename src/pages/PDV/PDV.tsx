import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import {
  ShoppingCart,
  Search,
  X,
  CreditCard,
  QrCode,
  Banknote,
  ArrowRight,
  LogOut,
  Store,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Minus,
  Plus,
  Trash2,
  Edit3,
  Lock,
  Loader2,
  Printer
} from 'lucide-react';
import { cupomDaVenda, CupomDados } from '../../lib/cupom';
import { imprimirVenda } from '../../lib/impressaoVenda';
import { imprimirFechamento } from '../../lib/impressao';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { Produto, ItemCarrinho, Sessao, Venda, Pagamento } from './types';
import CashOpsModal from './CashOpsModal';
import Modal from '../../components/Modal';
import { useMediaQuery } from '../../hooks/useMediaQuery';

type DocumentoFiscalPdv = {
  id: string;
  status: string;
  status_display: string;
  numero?: string;
  mensagem_sefaz?: string;
  pode_baixar_pdf: boolean;
};

type ScreenWakeLockSentinel = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: 'screen') => Promise<ScreenWakeLockSentinel>;
  };
};

const FORMAS_PAGAMENTO = [
  { key: 'DINHEIRO', label: 'Dinheiro', shortcut: 'F5', icon: Banknote, color: 'var(--accent-green)' },
  { key: 'PIX', label: 'Pix', shortcut: 'F6', icon: QrCode, color: 'var(--accent)' },
  { key: 'CARTAO_DEBITO', label: 'Débito', shortcut: 'F7', icon: CreditCard, color: 'var(--accent-yellow)' },
  { key: 'CARTAO_CREDITO', label: 'Crédito', shortcut: 'F8', icon: CreditCard, color: 'var(--accent-yellow)' },
];

// Exportado somente para os testes unitários dos cálculos monetários.
// eslint-disable-next-line react-refresh/only-export-components
export const toCents = (value: number) => Math.round((value + Number.EPSILON) * 100);

// eslint-disable-next-line react-refresh/only-export-components
export const maxDiscountInput = (
  totalCents: number,
  type: 'VALOR' | 'PERCENTUAL',
) => {
  const maxDiscountCents = Math.max(0, totalCents - 1);
  if (type === 'VALOR') return maxDiscountCents / 100;
  if (totalCents <= 0) return 0;
  return Math.floor((maxDiscountCents / totalCents) * 10_000) / 100;
};

// eslint-disable-next-line react-refresh/only-export-components
export const discountInCents = (
  totalCents: number,
  discount: number,
  type: 'VALOR' | 'PERCENTUAL',
) => {
  const safeDiscount = Math.min(Math.max(discount, 0), maxDiscountInput(totalCents, type));
  const calculated = type === 'VALOR'
    ? toCents(safeDiscount)
    : Math.round(totalCents * (safeDiscount / 100));
  return Math.min(calculated, Math.max(0, totalCents - 1));
};

/**
 * Interpreta o campo de busca do PDV: "3*789..." define a quantidade e um
 * termo só com dígitos é tratado como código (barras ou código interno).
 */
// eslint-disable-next-line react-refresh/only-export-components
export const parseEntradaPdv = (raw: string) => {
  let termo = raw.trim();
  let quantidade = 1;
  const multiplicador = termo.match(/^(\d+(?:[.,]\d+)?)\s*\*\s*(.*)$/);
  if (multiplicador) {
    const qtd = Number(multiplicador[1].replace(',', '.'));
    if (qtd > 0) {
      quantidade = qtd;
      termo = multiplicador[2].trim();
    }
  }
  return { termo, quantidade, ehCodigo: /^\d+$/.test(termo) };
};

// eslint-disable-next-line react-refresh/only-export-components
export const quantidadeRetornadaPeloCodigo = (
  produto: Produto,
  quantidadeDigitada: number,
) => {
  const quantidadeBalanca = Number(produto.quantidade_balanca);
  return quantidadeBalanca > 0 ? quantidadeBalanca : quantidadeDigitada;
};

import { toast } from 'sonner';

export default function PDV() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // O caixa não tem painel: sair do PDV encerra a sessão e volta ao login do caixa.
  const somentePdv = useAuthStore(state => Boolean(state.user?.somente_pdv));
  const logout = useAuthStore(state => state.logout);
  const sairDoPdv = () => {
    if (!somentePdv) {
      navigate('/dashboard');
      return;
    }
    logout();
    queryClient.clear();
    navigate('/caixa', { replace: true });
  };
  const resumeVendaId = searchParams.get('venda_id');
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<Produto[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [qtyMultiplier, setQtyMultiplier] = useState(1);
  // A venda é recuperada do servidor para a conta e sessão autenticadas.
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [venda, setVenda] = useState<Venda | null>(null);
  const [productAddingId, setProductAddingId] = useState<number | string | null>(null);

  // Mantém o monitor ligado enquanto o terminal do PDV estiver visível.
  // O navegador libera o bloqueio ao ocultar a página; ao retornar, pedimos
  // novamente para que o caixa continue pronto para leitura.
  useEffect(() => {
    const wakeLockApi = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLockApi) return;

    let disposed = false;
    let wakeLock: ScreenWakeLockSentinel | null = null;

    const requestWakeLock = async () => {
      if (disposed || document.visibilityState !== 'visible' || (wakeLock && !wakeLock.released)) return;

      try {
        const acquiredLock = await wakeLockApi.request('screen');
        if (disposed) {
          void acquiredLock.release();
          return;
        }

        wakeLock = acquiredLock;
        acquiredLock.addEventListener('release', () => {
          if (wakeLock === acquiredLock) wakeLock = null;
        });
      } catch {
        wakeLock = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void requestWakeLock();
    };

    void requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      const currentLock = wakeLock;
      wakeLock = null;
      if (currentLock && !currentLock.released) void currentLock.release();
    };
  }, []);

  // Operações de Caixa
  const [showCashOp, setShowCashOp] = useState(false);
  const [cashOpType, setCashOpType] = useState<'SANGRIA' | 'SUPRIMENTO'>('SANGRIA');
  const [modalFecharCaixaOpen, setModalFecharCaixaOpen] = useState(false);
  const [valorContado, setValorContado] = useState('');
  const [modalCancelarVendaOpen, setModalCancelarVendaOpen] = useState(false);
  const [desconto, setDesconto] = useState(0);
  const [tipoDesconto, setTipoDesconto] = useState<'VALOR' | 'PERCENTUAL'>('VALOR');
  const [showDesconto, setShowDesconto] = useState(false);

  // Impressão de comprovante
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printData, setPrintData] = useState<CupomDados | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [documentoFiscal, setDocumentoFiscal] = useState<DocumentoFiscalPdv | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Produto | null>(null);
  const [editingPrice, setEditingPrice] = useState('');
  const [isSavingPrice, setIsSavingPrice] = useState(false);

  const [showPagamento, setShowPagamento] = useState(false);
  const [fundoInicial, setFundoInicial] = useState('');
  const [activeTab, setActiveTab] = useState<'search' | 'cart'>('search');

  // Pagamentos Múltiplos
  const [pagamentosRealizados, setPagamentosRealizados] = useState<Pagamento[]>([]);
  const [formaPagto, setFormaPagto] = useState('DINHEIRO');
  const [valorPago, setValorPago] = useState('');
  const [clienteId, setClienteId] = useState<number | string | null>(null);
  const [buscaCliente, setBuscaCliente] = useState('Consumidor Final');
  const [showClienteDropdown, setShowClienteDropdown] = useState(false);

  // Clientes
  const { data: clientes } = useQuery({
    queryKey: ['clientes'],
    queryFn: async () => {
      const resp = await api.get('/clientes/');
      return resp.data.results || resp.data;
    }
  });

  const buscaRef = useRef<HTMLInputElement>(null);
  // Fila de adições: cada bipe é processado em ordem, um por vez, sem descartar
  // leituras rápidas nem criar duas vendas ao mesmo tempo.
  const filaAdicaoRef = useRef<Promise<void>>(Promise.resolve());
  const vendaRef = useRef<Venda | null>(venda);
  // Descarta respostas de buscas antigas que chegam fora de ordem.
  const buscaSeqRef = useRef(0);
  const buscaTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    vendaRef.current = venda;
  }, [venda]);
  useEffect(() => () => clearTimeout(buscaTimerRef.current), []);
  const valorPagoRef = useRef<HTMLInputElement>(null);

  // Totais
  const totalCentavos = carrinho.reduce((acc, item) => acc + toCents(item.subtotal), 0);
  const descontoCentavos = discountInCents(totalCentavos, desconto, tipoDesconto);
  const totalLiquidoCentavos = Math.max(0, totalCentavos - descontoCentavos);
  const totalPagoCentavos = pagamentosRealizados.reduce((acc, p) => acc + toCents(p.valor), 0);
  const valorRestanteCentavos = Math.max(0, totalLiquidoCentavos - totalPagoCentavos);
  const trocoCentavos = Math.max(0, totalPagoCentavos - totalLiquidoCentavos);
  const total = totalCentavos / 100;
  const valorDescontoReal = descontoCentavos / 100;
  const totalLiquido = totalLiquidoCentavos / 100;
  const totalJaPago = totalPagoCentavos / 100;
  const valorRestante = valorRestanteCentavos / 100;
  const troco = trocoCentavos / 100;

  const abrirPagamento = useCallback(() => {
    if (carrinho.length === 0) return;
    setShowDesconto(desconto > 0);
    setShowPagamento(true);
    setValorPago(valorRestante.toFixed(2));
    setTimeout(() => valorPagoRef.current?.focus(), 100);
  }, [carrinho.length, desconto, valorRestante]);

  const fecharPagamento = useCallback(() => {
    setShowPagamento(false);
    setShowClienteDropdown(false);
    setActiveTab('search');
    window.setTimeout(() => buscaRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (showPagamento) {
      // Mantém apenas a sugestão do próximo pagamento sincronizada; os
      // pagamentos já adicionados nunca são alterados por total/desconto.
      setValorPago(valorRestante.toFixed(2));
    }
  }, [showPagamento, valorRestante]);

  // 1. Check Active Session
  const { data: sessao, isLoading: loadingSessao } = useQuery<Sessao>({
    queryKey: ['sessao-ativa'],
    queryFn: async () => {
      try {
        const resp = await api.get('/sessoes-caixa/ativa/');
        return resp.data;
      } catch {
        return null;
      }
    },
    staleTime: Infinity, // Só recarrega se invalidado
  });

  // 2. Fetch Active Sale for Session
  const { data: vendaAberta } = useQuery({
    queryKey: ['venda-aberta', sessao?.id, resumeVendaId],
    queryFn: async () => {
      if (!sessao) return null;

      // Se houver um ID específico para retomar
      if (resumeVendaId) {
        try {
          const { data } = await api.get(`/vendas/${resumeVendaId}/`);
          if (data.status === 'EM_ABERTO' && String(data.sessao) === String(sessao.id)) return data;
        } catch {
          toast.error('Não foi possível carregar a venda solicitada.');
        }
      }

      // Fallback: carregar a primeira venda aberta da sessão
      const { data } = await api.get('/vendas/', { params: { sessao: sessao.id, status: 'EM_ABERTO' } });
      const results = data.results || data;
      return results.length > 0 ? results[0] : null;
    },
    enabled: !!sessao,
  });

  useEffect(() => {
    if (vendaAberta) {
      setVenda(vendaAberta);
      setCarrinho(vendaAberta.itens.map((i: any) => ({
        id: i.id,
        produto_id: i.produto?.id || i.produto,
        nome: i.produto?.nome || 'Produto sem nome',
        quantidade: parseFloat(i.quantidade),
        preco_unitario: parseFloat(i.preco_unitario),
        subtotal: parseFloat(i.subtotal),
        unidade: i.produto?.unidade_medida || 'UN'
      })));
    }
  }, [vendaAberta]);

  // Mutations
  const abrirCaixaMutation = useMutation({
    mutationFn: (fundo: number) => api.post('/sessoes-caixa/', { fundo_inicial: fundo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessao-ativa'] });
      setTimeout(() => buscaRef.current?.focus(), 200);
    },
  });

  const fecharCaixaMutation = useMutation({
    mutationFn: async (valor: number) => {
      await filaAdicaoRef.current;
      return api.post(`/sessoes-caixa/${sessao?.id}/fechar/`, { valor_contado: valor });
    },
    onSuccess: ({ data }) => {
      toast.success('Caixa fechado com sucesso!');
      if (data?.relatorio) {
        imprimirFechamento(data.relatorio).catch((error: Error) => {
          toast.error(`${error.message || 'Não foi possível imprimir o fechamento.'} Reimprima pela tela Fechamento de caixa.`);
        });
      }
      setModalFecharCaixaOpen(false);
      setValorContado('');
      vendaRef.current = null;
      queryClient.setQueriesData({ queryKey: ['venda-aberta'] }, null);
      void queryClient.invalidateQueries({ queryKey: ['fechamentos'] });
      void queryClient.invalidateQueries({ queryKey: ['fechamentos-vendas'] });
      void queryClient.invalidateQueries({ queryKey: ['vendas'] });
      setPagamentosRealizados([]);
      setDesconto(0);
      if (resumeVendaId) navigate('/pdv', { replace: true });
      queryClient.invalidateQueries({ queryKey: ['sessao-ativa'] });
      setCarrinho([]);
      setVenda(null);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.erro || 'Erro ao fechar o caixa.');
    }
  });

  const cancelarVendaMutation = useMutation({
    mutationFn: async () => {
      await filaAdicaoRef.current;
      const atual = vendaRef.current;
      if (atual) await api.post(`/vendas/${atual.id}/cancelar/`, { motivo: 'Cancelamento solicitado no PDV.' });
    },
    onSuccess: () => {
      vendaRef.current = null;
      setCarrinho([]);
      setVenda(null);
      setPagamentosRealizados([]);
      setBuscaCliente('Consumidor Final');
      setClienteId(null);
      setDesconto(0);
      setTipoDesconto('VALOR');
      setModalCancelarVendaOpen(false);
      setActiveTab('search');
      queryClient.setQueriesData({ queryKey: ['venda-aberta'] }, null);
      void queryClient.invalidateQueries({ queryKey: ['venda-aberta'] });
      void queryClient.invalidateQueries({ queryKey: ['vendas'] });
      void queryClient.invalidateQueries({ queryKey: ['fechamentos'] });
      void queryClient.invalidateQueries({ queryKey: ['fechamentos-vendas'] });
      if (resumeVendaId) navigate('/pdv', { replace: true });
      buscaRef.current?.focus();
      toast.success('Venda cancelada.');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.erro || err.response?.data?.detail || 'Não foi possível cancelar a venda. Tente novamente.');
    },
  });

  const removerItemMutation = useMutation({
    mutationFn: async ({ itemId, itemSubtotal }: { itemId: number | string, itemSubtotal: number }) => {
      await api.delete(`/venda-itens/${itemId}/`);
      // Atualiza total da venda
      if (venda) {
        const novoTotal = Math.max(0, Number(venda.total) - itemSubtotal);
        await api.patch(`/vendas/${venda.id}/`, { total: novoTotal });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['venda-aberta'] });
    },
    onError: () => toast.error('Erro ao remover item.'),
  });

  const criarVendaMutation = useMutation({
    mutationFn: (sessaoId: string) => api.post('/vendas/', { sessao: sessaoId, total: 0 }),
  });

  const adicionarItemMutation = useMutation({
    mutationFn: async ({ vendaId, produto, qty }: { vendaId: string, produto: Produto, qty: number }) => {
      const preco = Number(produto.preco_venda);
      const { data: item } = await api.post('/venda-itens/', {
        venda: vendaId,
        produto: produto.id,
        quantidade: qty,
        preco_unitario: preco,
        subtotal: preco * qty
      });
      return item;
    },
  });

  const finalizarVendaMutation = useMutation({
    mutationFn: async ({ pagamentos, emitirNfceSelecionada }: { pagamentos: Pagamento[]; emitirNfceSelecionada: boolean }) => {
      const respVenda = await api.post(`/vendas/${venda?.id}/finalizar/`, {
        pagamentos,
        cliente: clienteId,
        desconto: valorDescontoReal.toFixed(2)
      });
      let fiscal: DocumentoFiscalPdv | null = null;
      let erroFiscal = '';
      if (emitirNfceSelecionada) {
        try {
          const response = await api.post<DocumentoFiscalPdv>('/fiscal/documentos/emitir/', {
            venda: respVenda.data.id || venda?.id,
            tipo: 'NFCE',
            canal: 'PDV',
          });
          fiscal = response.data;
          if (fiscal.status !== 'AUTORIZADA') {
            erroFiscal = fiscal.mensagem_sefaz || `NFC-e ${fiscal.status_display.toLowerCase()}.`;
          }
        } catch (error: any) {
          erroFiscal = error.response?.data?.detail || 'Não foi possível emitir a NFC-e.';
        }
      }
      return { respVenda, fiscal, erroFiscal };
    },
    onSuccess: ({ respVenda, fiscal, erroFiscal }, variables) => {
      if (fiscal?.status === 'AUTORIZADA') toast.success('Venda finalizada e NFC-e autorizada!');
      else {
        toast.success('Venda finalizada!');
        if (erroFiscal) toast.error(`Venda concluída, mas a NFC-e não foi autorizada: ${erroFiscal}`);
      }
      setShowPagamento(false);
      setDocumentoFiscal(fiscal);

      // Sempre prepara os dados de impressão/compartilhamento e exibe o modal de sucesso
      const pagoCentavos = variables.pagamentos.reduce((acc, p) => acc + toCents(p.valor), 0);
      setPrintData(cupomDaVenda(respVenda.data, {
        pagamentos: [...variables.pagamentos],
        troco: Math.max(0, pagoCentavos - totalLiquidoCentavos) / 100,
      }));
      setShowPrintModal(true);

      queryClient.invalidateQueries({ queryKey: ['venda-aberta'] });
      setPagamentosRealizados([]);
      setCarrinho([]);
      setVenda(null);
      setClienteId(null);
      setBuscaCliente('Consumidor Final');
      setShowClienteDropdown(false);
      setDesconto(0);
      setTipoDesconto('VALOR');
      setShowDesconto(false);
      setTimeout(() => buscaRef.current?.focus(), 100);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.erro || 'Erro ao finalizar venda.');
    }
  });


  // Handlers
  const handleImprimir = async () => {
    if (!printData || isPrinting) return;
    setIsPrinting(true);
    try {
      await imprimirVenda(printData);
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Não foi possível imprimir a venda. Tente novamente.');
    } finally {
      setIsPrinting(false);
    }
  };

  const handleAbrirCaixa = () => {
    abrirCaixaMutation.mutate(parseFloat(fundoInicial || '0'));
  };

  const handleEditProduct = async (item: ItemCarrinho) => {
    try {
      const { data } = await api.get<Produto>(`/produtos/${item.produto_id}/`);
      setEditingProduct(data);
      setEditingPrice(Number(data.preco_venda).toFixed(2));
      setShowEditModal(true);
    } catch {
      toast.error('Erro ao carregar dados do produto.');
    }
  };

  const closeEditPriceModal = () => {
    if (isSavingPrice) return;
    setShowEditModal(false);
    setEditingProduct(null);
    setEditingPrice('');
    window.setTimeout(() => buscaRef.current?.focus(), 0);
  };

  const handleEditPrice = async () => {
    if (!editingProduct) return;
    const parsedPrice = Number(editingPrice.replace(',', '.'));
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      toast.error('Informe um preço de venda maior que zero.');
      return;
    }

    setIsSavingPrice(true);
    try {
      const { data: updatedProd } = await api.patch<Produto>(
        `/produtos/${editingProduct.id}/preco-pdv/`,
        { preco_venda: parsedPrice.toFixed(2) },
      );
      const novoPreco = Number(updatedProd.preco_venda);
      const itensToUpdate = carrinho.filter(item => item.produto_id === updatedProd.id);

      await Promise.all(itensToUpdate
        .filter(item => item.id)
        .map(item => api.patch(`/venda-itens/${item.id}/`, {
          quantidade: item.quantidade,
        })));

      setCarrinho(prev => prev.map(item => {
        if (item.produto_id === updatedProd.id) {
          return {
            ...item,
            nome: updatedProd.nome,
            preco_unitario: novoPreco,
            subtotal: item.quantidade * novoPreco,
          };
        }
        return item;
      }));

      await queryClient.invalidateQueries({ queryKey: ['venda-aberta'] });
      toast.success('Preço de venda atualizado!');
      setShowEditModal(false);
      setEditingProduct(null);
      setEditingPrice('');
      window.setTimeout(() => buscaRef.current?.focus(), 0);
    } catch (error: any) {
      await queryClient.invalidateQueries({ queryKey: ['venda-aberta'] });
      toast.error(
        error.response?.data?.detail
        || error.response?.data?.preco_venda?.[0]
        || 'Não foi possível atualizar o preço.',
      );
    } finally {
      setIsSavingPrice(false);
    }
  };

  const handleRemoverItem = (item: typeof carrinho[0], idx: number) => {
    if (item.id) {
      // Item persistido no servidor — remove via API
      removerItemMutation.mutate({ itemId: item.id, itemSubtotal: item.subtotal });
    }
    // Remove localmente imediatamente para UX fluida
    setCarrinho(prev => prev.filter((_, i) => i !== idx));
    if (venda) {
      // O total será recalculado automaticamente no servidor
      // Apenas atualizamos o estado local para refletir na UI
      setVenda(prev => prev ? { ...prev } : prev);
    }
  };

  const enfileirar = useCallback((tarefa: () => Promise<void>) => {
    const proxima = filaAdicaoRef.current.then(tarefa);
    filaAdicaoRef.current = proxima.catch(() => {});
    return proxima;
  }, []);

  const adicionarProduto = useCallback(async (produto: Produto, quantidade: number) => {
    setProductAddingId(produto.id);
    try {
      let currentVenda = vendaRef.current;
      if (!currentVenda && sessao) {
        const resp = await criarVendaMutation.mutateAsync(sessao.id);
        currentVenda = resp.data;
        vendaRef.current = currentVenda;
        setVenda(currentVenda);
      }
      if (!currentVenda) return;

      const item = await adicionarItemMutation.mutateAsync({
        vendaId: currentVenda.id,
        produto,
        qty: quantidade
      });

      setCarrinho(prev => {
        return [...prev, {
          id: item.id,
          produto_id: produto.id,
          nome: produto.nome,
          quantidade: Number(item.quantidade),
          preco_unitario: Number(item.preco_unitario),
          subtotal: Number(item.subtotal),
          unidade: produto.unidade_medida
        }];
      });
      await queryClient.invalidateQueries({ queryKey: ['venda-aberta'] });
    } catch {
      toast.error(`Erro ao adicionar ${produto.nome}.`);
    } finally {
      setProductAddingId(null);
    }
  }, [sessao, adicionarItemMutation, criarVendaMutation, queryClient]);

  const limparBusca = useCallback(() => {
    clearTimeout(buscaTimerRef.current);
    buscaSeqRef.current += 1;
    setBusca('');
    setResultados([]);
    setSelectedIndex(0);
    setQtyMultiplier(1);
  }, []);

  /** Adiciona um produto escolhido na lista (clique ou Enter no texto). */
  const handleAdicionarItem = useCallback((produto: Produto, quantidade = qtyMultiplier) => {
    limparBusca();
    buscaRef.current?.focus();
    return enfileirar(() => adicionarProduto(produto, quantidade || 1));
  }, [qtyMultiplier, limparBusca, enfileirar, adicionarProduto]);

  /** Leitor de código de barras: só adiciona quando o código bate por completo. */
  const handleCodigo = useCallback((codigo: string, quantidade: number) => {
    limparBusca();
    return enfileirar(async () => {
      try {
        const { data } = await api.get<Produto[]>('/produtos/por-codigo/', { params: { codigo } });
        if (data.length === 1) {
          await adicionarProduto(
            data[0],
            quantidadeRetornadaPeloCodigo(data[0], quantidade),
          );
        } else if (data.length === 0) {
          toast.error(`Produto não encontrado: ${codigo}`);
        } else {
          setResultados(data);
          setSelectedIndex(0);
          setQtyMultiplier(quantidade);
          toast.warning('Mais de um produto com este código. Escolha na lista.');
        }
      } catch {
        toast.error(`Erro ao buscar o código ${codigo}.`);
      }
    });
  }, [limparBusca, enfileirar, adicionarProduto]);

  const handleBusca = useCallback((q: string) => {
    setBusca(q);
    const { termo, quantidade } = parseEntradaPdv(q);
    setQtyMultiplier(quantidade);

    clearTimeout(buscaTimerRef.current);
    const seq = ++buscaSeqRef.current;

    if (!termo) {
      setResultados([]);
      setSelectedIndex(0);
      return;
    }

    // Espera o usuário/leitor parar de digitar; o leitor digita o código
    // inteiro em poucos milissegundos e termina com Enter.
    buscaTimerRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get('/produtos/busca-pdv/', { params: { q: termo } });
        if (seq !== buscaSeqRef.current) return;
        setResultados(data);
        setSelectedIndex(0);
      } catch {
        if (seq === buscaSeqRef.current) setResultados([]);
      }
    }, 250);
  }, []);

  const handleEnterBusca = (valor: string) => {
    const { termo, quantidade, ehCodigo } = parseEntradaPdv(valor);
    if (!termo) return;

    if (ehCodigo) {
      handleCodigo(termo, quantidade);
      return;
    }

    const produto = resultados[selectedIndex];
    if (produto) handleAdicionarItem(produto, quantidade);
  };

  /**
   * Conclui a venda (botão ou F4). Se ainda faltar valor e houver um valor
   * digitado no campo, ele entra como pagamento na forma selecionada, para
   * que F2 → F4 finalize direto com o valor sugerido.
   */
  const concluirVenda = (transmitirNfce = false) => {
    if (finalizarVendaMutation.isPending) return;

    let pagamentos = pagamentosRealizados;
    let pagoCentavos = totalPagoCentavos;
    if (pagoCentavos < totalLiquidoCentavos) {
      const digitado = parseFloat(valorPago || '0');
      const digitadoCentavos = Number.isFinite(digitado) ? toCents(digitado) : 0;
      if (digitadoCentavos > 0) {
        pagamentos = [...pagamentos, { forma: formaPagto, valor: digitadoCentavos / 100 }];
        pagoCentavos += digitadoCentavos;
        setPagamentosRealizados(pagamentos);
        setValorPago('');
      }
    }

    if (pagamentos.length === 0 || pagoCentavos < totalLiquidoCentavos) {
      toast.error('O pagamento não cobre o total da venda.');
      return;
    }
    finalizarVendaMutation.mutate({ pagamentos, emitirNfceSelecionada: transmitirNfce });
  };

  const handleAddPagamento = () => {
    const valor = parseFloat(valorPago || '0');
    const valorCentavos = Number.isFinite(valor) ? toCents(valor) : 0;
    if (valorCentavos <= 0) {
      toast.error('Informe um valor de pagamento válido.');
      return;
    }
    setPagamentosRealizados(prev => [
      ...prev,
      { forma: formaPagto, valor: valorCentavos / 100 },
    ]);
    setValorPago('');
    valorPagoRef.current?.focus();
  };

  const handleDescontoChange = (rawValue: string) => {
    const parsedValue = Number(rawValue);
    if (!Number.isFinite(parsedValue)) {
      setDesconto(0);
      return;
    }
    const maxValue = maxDiscountInput(totalCentavos, tipoDesconto);
    setDesconto(Math.min(Math.max(parsedValue, 0), maxValue));
  };

  const handleTipoDescontoChange = (tipo: 'VALOR' | 'PERCENTUAL') => {
    setTipoDesconto(tipo);
    setDesconto(0);
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const hasOpenModal = showPagamento
      || showCashOp
      || modalFecharCaixaOpen
      || modalCancelarVendaOpen
      || showPrintModal
      || showEditModal;

    const handler = (e: KeyboardEvent) => {
      if (hasOpenModal) return;
      if (e.key === 'F2') {
        e.preventDefault();
        if (carrinho.length > 0) {
           abrirPagamento();
        }
      }
      if (e.key === 'F3') { e.preventDefault(); setActiveTab('search'); buscaRef.current?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    abrirPagamento,
    carrinho.length,
    modalCancelarVendaOpen,
    modalFecharCaixaOpen,
    showCashOp,
    showEditModal,
    showPagamento,
    showPrintModal,
  ]);

  // Atalhos do pagamento: F4 conclui e F5–F8 selecionam a forma.
  const concluirVendaRef = useRef(concluirVenda);
  concluirVendaRef.current = concluirVenda;
  useEffect(() => {
    if (!showPagamento) return;
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'F4') {
        e.preventDefault();
        concluirVendaRef.current();
        return;
      }

      const forma = FORMAS_PAGAMENTO.find(item => item.shortcut === e.key);
      if (!forma) return;
      e.preventDefault();
      setFormaPagto(forma.key);
      valorPagoRef.current?.focus();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showPagamento]);

  if (loadingSessao) return <div className="loading">Iniciando terminal de venda...</div>;

  // Tela de Abertura de Caixa
  if (!sessao) {
    return (
      <div className="login-page">
         <div className="login-card animate-in" style={{ textAlign: 'center' }}>
            <div style={{ padding: 20, background: 'rgba(59, 130, 246, 0.1)', borderRadius: '50%', width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
                <Store size={40} style={{ color: 'var(--accent)' }} />
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: 8 }}>Abertura de Caixa</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>Informe o fundo de reserva para iniciar o expediente.</p>

            <div className="form-group" style={{ marginBottom: 24 }}>
                <label className="form-label" htmlFor="opening-balance">Fundo Inicial (R$)</label>
                <input
                  id="opening-balance"
                  className="input"
                  type="number"
                  step="0.01"
                  autoFocus
                  value={fundoInicial}
                  onChange={e => setFundoInicial(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAbrirCaixa()}
                  style={{ textAlign: 'center', fontSize: '1.5rem', height: 60, fontWeight: 700 }}
                  placeholder="0,00"
                />
            </div>
            <button className="btn btn-primary" onClick={handleAbrirCaixa} style={{ width: '100%', padding: 16, fontSize: '1rem' }}>
                Iniciar Vendas
                <ArrowRight size={18} />
            </button>
            <button className="btn btn-ghost" onClick={sairDoPdv} style={{ width: '100%', marginTop: 12 }}>{somentePdv ? 'Sair' : 'Voltar ao Painel'}</button>
         </div>
      </div>
    );
  }

  return (
    <div className="pdv-container">
      {/* HEADER */}
      <header className="pdv-header" style={{ padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: '0.9rem', letterSpacing: '-0.5px' }} className="pdv-header-logo">
            <img src="/bella-fornada-logo.png" alt="" style={{ width: 30, height: 30, borderRadius: 8, objectFit: 'cover' }} />
            Bella Fornada <span className="text-accent">PDV</span>
          </div>
          {venda && (
            <span style={{ fontSize: '0.65rem', fontWeight: 700, background: 'rgba(59,130,246,0.1)', color: 'var(--accent)', padding: '2px 6px', borderRadius: 4 }}>
              #{String(venda.id).slice(-4).toUpperCase()}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Menu de Ações (Oculto em telas muito pequenas, ou em dropdown futuramente) */}
          <div className="pdv-actions-desktop" style={{ display: 'flex', gap: 4 }}>
            <button aria-label="Registrar sangria" className="btn btn-ghost btn-sm" style={{ padding: '6px 8px', color: 'var(--accent-yellow)' }} onClick={() => { setCashOpType('SANGRIA'); setShowCashOp(true); }}>
              <Minus size={14} />
              <span className="hide-mobile">Sangria</span>
            </button>
            <button aria-label="Registrar suprimento" className="btn btn-ghost btn-sm" style={{ padding: '6px 8px', color: 'var(--accent-green)' }} onClick={() => { setCashOpType('SUPRIMENTO'); setShowCashOp(true); }}>
              <Plus size={14} />
              <span className="hide-mobile">Suprimento</span>
            </button>
            <button aria-label="Cancelar venda atual" className="btn btn-ghost btn-sm" style={{ padding: '6px 8px', color: 'var(--accent-red)' }} onClick={() => setModalCancelarVendaOpen(true)}>
              <Trash2 size={14} />
              <span className="hide-mobile">Cancelar</span>
            </button>
            <button aria-label="Fechar caixa" className="btn btn-ghost btn-sm" style={{ padding: '6px 8px', color: 'var(--accent-yellow)' }} onClick={() => setModalFecharCaixaOpen(true)}>
              <Lock size={14} />
              <span className="hide-mobile">Fechar Caixa</span>
            </button>
          </div>

          <button aria-label={somentePdv ? 'Sair do PDV' : 'Voltar ao painel'} title={somentePdv ? 'Sair' : 'Voltar ao painel'} className="btn btn-ghost btn-sm pdv-header-icon-button" onClick={sairDoPdv}>
             <LogOut size={16} />
          </button>
        </div>
      </header>

      <div className="pdv-body">
        {/* BUSCA DE PRODUTOS */}
        <section className={`pdv-search-column ${activeTab === 'search' ? 'active' : ''}`}>
           <div style={{ position: 'relative', marginBottom: 16 }}>
              <Search size={20} style={{ position: 'absolute', left: 14, top: 15, color: 'var(--text-muted)' }} />
              <input
                ref={buscaRef}
                className="input"
                placeholder="Buscar produto... (F3)"
                style={{ height: 50, paddingLeft: 46, fontSize: '1.08rem', borderRadius: 10, fontWeight: 600 }}
                value={busca}
                onChange={e => handleBusca(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelectedIndex(prev => Math.min(prev + 1, resultados.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedIndex(prev => Math.max(prev - 1, 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    handleEnterBusca(e.currentTarget.value);
                  }
                }}
                autoFocus
              />
           </div>

           <div style={{ flex: 1, overflowY: 'auto' }}>
              {resultados.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {resultados.map((p, i) => (
                    <div
                      key={p.id}
                      className="card animate-in"
                      role="button"
                      tabIndex={0}
                      style={{
                        padding: '13px 16px',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        border: selectedIndex === i ? '2px solid var(--accent)' : '1px solid var(--border)',
                        background: selectedIndex === i ? 'var(--bg-hover)' : 'transparent'
                      }}
                      onClick={() => handleAdicionarItem(p)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleAdicionarItem(p);
                        }
                      }}
                    >
                       <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 750, fontSize: '1.02rem', lineHeight: 1.25 }}>{p.nome}</div>
                          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 3 }}>{p.unidade_medida || 'UN'} · {p.codigo_legado || ''}</div>
                       </div>
                       <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '1.16rem', fontWeight: 850, color: 'var(--accent-green)' }}>R$ {Number(p.preco_venda).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                          {productAddingId === p.id ? (
                            <Loader2 size={16} className="animate-spin text-accent" />
                          ) : (
                            <div style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 750 }}>+ ADICIONAR</div>
                          )}
                       </div>
                    </div>
                  ))}
                </div>
              ) : busca ? (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
                  <p>Não encontrado.</p>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: 40, opacity: 0.2 }}>
                   <ShoppingCart size={40} style={{ margin: '0 auto 12px' }} />
                   <p style={{ fontSize: '0.85rem', fontWeight: 600 }}>PDV Pronto para Venda</p>
                </div>
              )}
           </div>
        </section>

        {/* CARRINHO / CUPOM */}
        <section className={`pdv-cart-column ${activeTab === 'cart' ? 'active' : ''}`}>
           <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                 <h3 style={{ fontSize: '1.02rem', fontWeight: 850 }}>CARRINHO</h3>
                 <span className="badge badge-blue">{carrinho.length} ITENS</span>
              </div>

              <div style={{ flex: 1, overflowY: 'auto' }}>
                 {carrinho.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        Carrinho vazio
                    </div>
                 ) : (
                    carrinho.map((item, idx) => (
                       <div key={idx} style={{ padding: '13px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ flex: 1 }}>
                             <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{
                                  fontSize: '0.68rem', fontWeight: 800,
                                  background: 'rgba(99,102,241,0.15)',
                                  color: 'var(--accent)',
                                  borderRadius: 4, padding: '1px 5px',
                                  minWidth: 22, textAlign: 'center',
                                  letterSpacing: '0.5px',
                                  flexShrink: 0
                                }}>#{idx + 1}</span>
                                <span style={{ fontSize: '0.98rem', fontWeight: 750, lineHeight: 1.25 }}>{item.nome}</span>
                             </div>
                             <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginLeft: 28, marginTop: 3 }}>{item.quantidade} x R$ {item.preco_unitario.toFixed(2)}</div>
                          </div>
                          <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: 8 }}>
                             <div style={{ fontSize: '1rem', fontWeight: 850 }}>R$ {item.subtotal.toFixed(2)}</div>
                             <button
                                type="button"
                                className="pdv-item-action"
                                onClick={() => handleEditProduct(item)}
                                title="Alterar preço de venda"
                                aria-label={`Alterar preço de ${item.nome}`}
                              >
                                <Edit3 size={14} />
                              </button>
                             <button
                                type="button"
                                className="pdv-item-action danger"
                                onClick={() => handleRemoverItem(item, idx)}
                                title="Remover"
                                aria-label={`Remover ${item.nome}`}
                              >
                                <Trash2 size={14} />
                              </button>
                          </div>
                       </div>
                    ))
                 )}
              </div>

              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '2px dashed var(--border)' }}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 750, color: 'var(--text-muted)' }}>TOTAL</span>
                    <span style={{ fontSize: '2.25rem', fontWeight: 900, color: 'var(--accent-green)', letterSpacing: '-1px' }}>
                      R$ {total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                 </div>

                 <div style={{ display: 'flex', gap: 8 }}>
                    <button
                       className="btn btn-primary"
                       style={{ flex: 1, height: 60, fontSize: '1.08rem', fontWeight: 850 }}
                       onClick={() => {
                         if (isMobile && activeTab === 'search') {
                            setActiveTab('cart');
                         } else {
                            abrirPagamento();
                         }
                       }}
                       disabled={carrinho.length === 0}
                    >
                       {isMobile && activeTab === 'search' ? 'VER CARRINHO' : 'PAGAR (F2)'}
                    </button>
                 </div>
              </div>
           </div>
        </section>
      </div>

      {/* MOBILE BOTTOM NAV */}
      <nav className="pdv-mobile-nav">
         <button className={`btn ${activeTab === 'search' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('search')}>
            <Search size={18} />
            Produtos
         </button>
         <button className={`btn ${activeTab === 'cart' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('cart')} style={{ position: 'relative' }}>
            <ShoppingCart size={18} />
            Carrinho
            {carrinho.length > 0 && (
              <span style={{ position: 'absolute', top: -5, right: -5, background: 'var(--accent-red)', color: 'white', fontSize: '10px', width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>
                {carrinho.length}
              </span>
            )}
         </button>
      </nav>

      {/* MODAL DE PAGAMENTO */}
      {showPagamento && (
        <Modal
          onClose={fecharPagamento}
          labelledBy="pdv-payment-title"
          overlayClassName="pdv-payment-overlay"
          panelClassName="card animate-in modal-panel modal-panel-lg pdv-payment-modal"
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
               <h2 id="pdv-payment-title" style={{ fontSize: '1.5rem', fontWeight: 900 }}>Finalização de Venda</h2>
               <button onClick={fecharPagamento} className="btn-icon" aria-label="Fechar pagamento"><X size={24} /></button>
            </div>

            <div className="pdv-payment-grid">

                {/* Coluna Esquerda: Lançamento de Pagamento */}
                <div style={{ flex: 1 }}>
                   <div className="form-group" style={{ marginBottom: 16, position: 'relative' }}>
                      <label className="form-label" htmlFor="payment-customer" style={{ fontSize: '0.75rem' }}>Identificar Cliente</label>
                      <div className="search-input-wrapper" style={{ margin: 0 }}>
                         <Search size={16} className="search-icon" />
                         <input
                            id="payment-customer"
                            className="input"
                            style={{ height: 44, borderRadius: 10, paddingLeft: 36 }}
                            placeholder="Pesquisar cliente..."
                            value={buscaCliente}
                            onChange={e => {
                               setBuscaCliente(e.target.value);
                               setShowClienteDropdown(true);
                            }}
                            onFocus={e => {
                               if (buscaCliente === 'Consumidor Final') e.target.select();
                               setShowClienteDropdown(true);
                            }}
                         />
                         {clienteId && (
                            <button
                              onClick={() => {
                                 setClienteId(null);
                                 setBuscaCliente('Consumidor Final');
                              }}
                              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer' }}
                            >
                               <X size={16} className="text-muted" />
                            </button>
                         )}
                      </div>

                      {showClienteDropdown && (
                        <div style={{
                          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                          background: 'var(--bg-card)', border: '1px solid var(--border)',
                          borderRadius: 10, marginTop: 4, maxHeight: 200, overflowY: 'auto',
                          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.4)'
                        }}>
                           <div
                             style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}
                             onClick={() => {
                                setClienteId(null);
                                setBuscaCliente('Consumidor Final');
                                setShowClienteDropdown(false);
                             }}
                           >
                             Consumidor Final
                           </div>
                           {(clientes || [])
                            .filter((c: any) => c.nome.toLowerCase().includes(buscaCliente.toLowerCase()))
                            .map((c: any) => (
                              <div
                                key={c.id}
                                style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}
                                onClick={() => {
                                   setClienteId(c.id);
                                   setBuscaCliente(c.nome);
                                   setShowClienteDropdown(false);
                                }}
                              >
                                {c.nome}
                              </div>
                           ))}
                        </div>
                      )}
                   </div>

                   <div className="pdv-discount-section">
                      <button
                        type="button"
                        className="btn btn-ghost pdv-discount-toggle"
                        aria-expanded={showDesconto}
                        aria-controls="payment-discount-controls"
                        onClick={() => {
                          if (showDesconto) setDesconto(0);
                          setShowDesconto(current => !current);
                        }}
                      >
                        {showDesconto ? <Trash2 size={18} /> : <Plus size={18} />}
                        {showDesconto ? 'Remover desconto' : 'Adicionar desconto'}
                      </button>
                      {showDesconto && (
                        <div id="payment-discount-controls" className="pdv-discount-controls">
                          <div className="pdv-discount-header">
                            <label className="form-label" htmlFor="payment-discount">Desconto</label>
                          </div>
                          <div className="pdv-discount-row">
                            <div className="pdv-discount-type" role="group" aria-label="Tipo de desconto">
                           <button
                             type="button"
                             className={`btn btn-xs ${tipoDesconto === 'VALOR' ? 'btn-primary' : ''}`}
                             aria-pressed={tipoDesconto === 'VALOR'}
                             onClick={() => handleTipoDescontoChange('VALOR')}
                           >R$</button>
                           <button
                             type="button"
                             className={`btn btn-xs ${tipoDesconto === 'PERCENTUAL' ? 'btn-primary' : ''}`}
                             aria-pressed={tipoDesconto === 'PERCENTUAL'}
                             onClick={() => handleTipoDescontoChange('PERCENTUAL')}
                           >%</button>
                            </div>
                            <input
                              id="payment-discount"
                              className="input pdv-discount-input"
                              type="number"
                              inputMode="decimal"
                              min="0"
                              max={maxDiscountInput(totalCentavos, tipoDesconto)}
                              step="0.01"
                              aria-describedby="payment-discount-limit"
                              placeholder={tipoDesconto === 'VALOR' ? '0,00' : '0%'}
                              value={desconto || ''}
                              onChange={e => handleDescontoChange(e.target.value)}
                            />
                          </div>
                          <span id="payment-discount-limit" className="field-hint">
                            Máximo: {tipoDesconto === 'PERCENTUAL'
                              ? `${maxDiscountInput(totalCentavos, tipoDesconto).toFixed(2)}%`
                              : `R$ ${maxDiscountInput(totalCentavos, tipoDesconto).toFixed(2)}`}
                            {' '}— o total mínimo da venda é R$ 0,01.
                          </span>
                        </div>
                      )}
                   </div>

                   <div className="form-group pdv-payment-method-section">
                      <span id="payment-method-label" className="form-label">Forma de pagamento</span>
                      <div role="group" aria-labelledby="payment-method-label" className="pdv-payment-methods">
                         {FORMAS_PAGAMENTO.map(f => (
                           <button
                             key={f.key}
                             type="button"
                             className="payment-method-button"
                             aria-pressed={formaPagto === f.key}
                             aria-keyshortcuts={f.shortcut}
                             title={`${f.label} (${f.shortcut})`}
                             onClick={() => setFormaPagto(f.key)}
                            >
                             <f.icon size={22} />
                             <span>{f.label}</span>
                             <kbd className="pdv-payment-shortcut" aria-hidden="true">{f.shortcut}</kbd>
                           </button>
                         ))}
                      </div>
                   </div>

                   <div className="form-group pdv-payment-value-section">
                      <label className="form-label" htmlFor="payment-value">Valor a receber</label>
                      <div className="pdv-payment-value-row">
                         <input
                           id="payment-value"
                           ref={valorPagoRef}
                           className="input"
                           type="number"
                           inputMode="decimal"
                           min="0.01"
                           step="0.01"
                           value={valorPago}
                           onChange={e => setValorPago(e.target.value)}
                           onKeyDown={e => e.key === 'Enter' && handleAddPagamento()}
                         />
                         <button type="button" className="btn btn-primary" onClick={handleAddPagamento}>
                           <Plus size={20} /> Adicionar pagamento
                         </button>
                      </div>
                   </div>

                   {/* Lista de Pagamentos já feitos */}
                   {pagamentosRealizados.length > 0 && (
                     <div style={{ marginTop: 16, padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 10 }}>
                        {pagamentosRealizados.map((p, i) => (
                           <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.85rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 4 }}>
                              <span style={{ fontWeight: 600 }}>{p.forma}</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                 <strong>R$ {p.valor.toFixed(2)}</strong>
                                 <button type="button" className="pdv-item-action danger" aria-label={`Remover pagamento ${p.forma}`} onClick={() => setPagamentosRealizados(prev => prev.filter((_, idx) => idx !== i))}>✕</button>
                              </div>
                           </div>
                        ))}
                     </div>
                   )}
                </div>

                {/* Coluna Direita: Resumo */}
                <div className="pdv-payment-summary">
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.9rem' }}>
                       <span style={{ color: 'var(--text-muted)' }}>Subtotal:</span>
                       <span style={{ fontWeight: 600 }}>R$ {total.toFixed(2)}</span>
                    </div>
                    {valorDescontoReal > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.9rem', color: 'var(--accent-red)' }}>
                        <span>Desconto {tipoDesconto === 'PERCENTUAL' ? `(${desconto}%)` : ''}:</span>
                        <span>- R$ {valorDescontoReal.toFixed(2)}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                       <span style={{ fontWeight: 800 }}>TOTAL LÍQUIDO:</span>
                       <span style={{ fontWeight: 900, color: 'var(--accent-green)', fontSize: '1.5rem' }}>R$ {totalLiquido.toFixed(2)}</span>
                    </div>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div className="kpi-label">RECEBIDO</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--accent-green)' }}>R$ {totalJaPago.toFixed(2)}</div>
                   </div>
                   <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                      {valorRestante > 0 ? (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div className="kpi-label" style={{ color: 'var(--accent-red)' }}>FALTA</div>
                          <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--accent-red)' }}>R$ {valorRestante.toFixed(2)}</div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div className="kpi-label" style={{ color: 'var(--accent-green)' }}>TROCO</div>
                          <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--accent-green)' }}>R$ {troco.toFixed(2)}</div>
                        </div>
                      )}
                   </div>
                </div>
            </div>

            <div className={`pdv-payment-actions${isMobile ? ' mobile' : ''}`}>
               <button className="btn btn-ghost" style={{ flex: 1, height: 50, fontSize: '1rem', fontWeight: 800 }}
                 onClick={() => concluirVenda(false)}
                 disabled={finalizarVendaMutation.isPending}
                 aria-keyshortcuts="F4"
               >
                  <CheckCircle2 size={20} />
                  {finalizarVendaMutation.isPending ? 'CONCLUINDO...' : 'FINALIZAR VENDA (F4)'}
               </button>
               <button className="btn btn-primary" style={{ flex: 1, height: 50, fontSize: '1rem', fontWeight: 800, background: 'var(--accent-green)' }}
                 onClick={() => concluirVenda(true)}
                 disabled={finalizarVendaMutation.isPending}
               >
                  <FileText size={20} />
                  {finalizarVendaMutation.isPending ? 'TRANSMITINDO...' : 'FINALIZAR E TRANSMITIR NFC-e'}
               </button>
            </div>
        </Modal>
      )}

      {showCashOp && sessao && (
        <CashOpsModal
          sessaoId={sessao.id}
          tipo={cashOpType}
          onClose={() => setShowCashOp(false)}
        />
      )}

      {modalFecharCaixaOpen && (
        <Modal
          onClose={() => setModalFecharCaixaOpen(false)}
          isBusy={fecharCaixaMutation.isPending}
          labelledBy="cash-closing-title"
          describedBy="cash-closing-description"
          panelClassName="modal-content modal-panel-sm"
        >
            <div className="modal-header">
              <div>
                <h2 id="cash-closing-title" className="modal-title">Fechar caixa</h2>
                <p id="cash-closing-description" className="modal-subtitle">Confira o dinheiro físico. Ao confirmar, todas as vendas em aberto deste caixa serão canceladas automaticamente antes de encerrar.</p>
              </div>
              <button className="btn-icon" onClick={() => setModalFecharCaixaOpen(false)} disabled={fecharCaixaMutation.isPending} aria-label="Fechar modal">
                <X size={20} />
              </button>
            </div>
            <div className="cash-closing-summary">
              <div><span>Fundo inicial</span><strong>R$ {Number(sessao.fundo_inicial || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="cash-closing-value">Dinheiro contado no caixa (R$) *</label>
              <input id="cash-closing-value" className="input input-emphasis" type="number" min="0" step="0.01" required autoFocus disabled={fecharCaixaMutation.isPending} value={valorContado} onChange={e => setValorContado(e.target.value)} placeholder="Conte as notas e moedas" />
              <p className="field-hint">Conte todo o dinheiro da gaveta, inclusive o fundo inicial. O valor esperado e a diferença saem só na impressão do fechamento.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" disabled={fecharCaixaMutation.isPending} onClick={() => setModalFecharCaixaOpen(false)}>Cancelar</button>
              <button
                className="btn btn-danger"
                onClick={() => fecharCaixaMutation.mutate(Number(valorContado))}
                disabled={valorContado === '' || !Number.isFinite(Number(valorContado)) || Number(valorContado) < 0 || fecharCaixaMutation.isPending}
              >
                {fecharCaixaMutation.isPending ? 'Fechando...' : 'Conferir e fechar'}
              </button>
            </div>
        </Modal>
      )}

      {modalCancelarVendaOpen && (
        <Modal
          onClose={() => setModalCancelarVendaOpen(false)}
          isBusy={cancelarVendaMutation.isPending}
          labelledBy="cancel-sale-title"
          describedBy="cancel-sale-description"
          panelClassName="modal-content modal-panel-sm modal-text-center"
        >
             <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
               <div style={{ padding: 16, background: 'rgba(239, 68, 68, 0.1)', borderRadius: '50%', color: 'var(--accent-red)' }}>
                  <AlertTriangle size={32} />
               </div>
             </div>
             <h3 id="cancel-sale-title" style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: 12 }}>Cancelar Venda?</h3>
             <p id="cancel-sale-description" style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: '0.9rem' }}>
               A venda atual será cancelada no sistema e o carrinho será limpo após a confirmação do servidor. Esta ação não pode ser desfeita.
             </p>
             <div style={{ display: 'flex', gap: 10 }}>
               <button data-modal-initial-focus className="btn btn-ghost" style={{ flex: 1 }} disabled={cancelarVendaMutation.isPending} onClick={() => setModalCancelarVendaOpen(false)}>
                 Voltar
               </button>
               <button className="btn btn-primary" style={{ flex: 1, background: 'var(--accent-red)' }} onClick={() => cancelarVendaMutation.mutate()} disabled={cancelarVendaMutation.isPending}>
                 {cancelarVendaMutation.isPending ? 'Cancelando...' : 'Sim, Cancelar'}
               </button>
             </div>
        </Modal>
      )}

      {showPrintModal && (
        <Modal
          onClose={() => { setShowPrintModal(false); setPrintData(null); setDocumentoFiscal(null); }}
          isBusy={isPrinting}
          labelledBy="print-sale-title"
          describedBy="print-sale-description"
          overlayClassName="modal-overlay-raised"
          panelClassName="modal-content animate-in modal-panel-md modal-text-center pdv-print-modal"
        >
             <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
               <div style={{ padding: 16, background: 'rgba(59, 130, 246, 0.1)', borderRadius: '50%', color: 'var(--accent)' }}>
                  <FileText size={32} />
               </div>
             </div>
             <h3 id="print-sale-title" style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: 12 }}>{documentoFiscal?.status === 'AUTORIZADA' ? 'Venda concluída e NFC-e autorizada!' : 'Venda Concluída!'}</h3>
             <p id="print-sale-description" style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: '0.9rem' }}>
               {documentoFiscal?.status === 'AUTORIZADA'
                 ? `NFC-e nº ${documentoFiscal.numero || 'autorizada'}. A impressão usará o DANFC-e disponível; caso contrário, o comprovante sem valor fiscal.`
                 : 'A impressão usará o documento fiscal disponível ou o comprovante sem valor fiscal.'}
             </p>
             <div style={{ display: 'flex', gap: 10 }}>
               <button className="btn btn-ghost" style={{ flex: 1 }} disabled={isPrinting} onClick={() => {
                 setShowPrintModal(false);
                 setPrintData(null);
                 setDocumentoFiscal(null);
               }}>
                 Fechar
               </button>
               <button className="btn btn-primary" style={{ flex: 1, background: '#10b981' }} onClick={handleImprimir} disabled={isPrinting} autoFocus>
                 <Printer size={18} />
                 {isPrinting ? 'Preparando impressão...' : 'Imprimir'}
               </button>
             </div>
        </Modal>
      )}
      {showEditModal && editingProduct && (
        <Modal
          onClose={closeEditPriceModal}
          labelledBy="pdv-edit-price-title"
          describedBy="pdv-edit-price-description"
          panelClassName="modal-content modal-panel-sm"
          isBusy={isSavingPrice}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleEditPrice();
            }}
          >
            <div className="modal-header">
              <div>
                <h2 id="pdv-edit-price-title" className="modal-title">Alterar preço de venda</h2>
                <p id="pdv-edit-price-description" className="modal-subtitle">
                  {editingProduct.nome}. Esta alteração também vale para as próximas vendas.
                </p>
              </div>
              <button
                type="button"
                className="btn-icon"
                onClick={closeEditPriceModal}
                aria-label="Fechar alteração de preço"
                disabled={isSavingPrice}
              >
                <X size={20} />
              </button>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="pdv-edit-price">Novo preço de venda (R$)</label>
              <input
                id="pdv-edit-price"
                className="input input-emphasis"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                data-modal-initial-focus
                value={editingPrice}
                onChange={event => setEditingPrice(event.target.value)}
                onFocus={event => event.currentTarget.select()}
                disabled={isSavingPrice}
              />
              <p className="field-hint">Somente o preço será alterado; estoque e dados fiscais permanecem protegidos.</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={closeEditPriceModal} disabled={isSavingPrice}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={isSavingPrice}>
                {isSavingPrice ? <><Loader2 size={18} className="animate-spin" /> Salvando...</> : 'Salvar preço'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
