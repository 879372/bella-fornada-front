/**
 * Impressão do cupom pelo PDV: monta o DAV em HTML de 80mm e imprime pelo
 * driver da impressora instalado no Windows. Com o Chrome aberto pelo atalho
 * com --kiosk-printing, confirma automaticamente a impressão. A prévia nativa
 * do Chrome ainda pode aparecer brevemente, conforme a configuração do caixa.
 */
import { CupomDados, FORMAS, LOJA, moeda } from './cupom';

export async function imprimirCupom(dados: CupomDados) {
  await imprimirPeloSistema(montarCupomHtml(dados));
}

/** Aciona a impressão do PDF fiscal no próprio navegador, sem abrir outra aba. */
export async function imprimirPdf(pdf: Blob) {
  if (!pdf.size || pdf.type !== 'application/pdf') {
    throw new Error('O PDF fiscal recebido está vazio ou em formato inválido.');
  }
  const { pdfParaHtmlTermico } = await import('./pdfTermico');
  await imprimirPeloSistema(await pdfParaHtmlTermico(pdf));
}

const escapar = (texto: unknown) => String(texto ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const quantidade = (valor: number) =>
  Number.isInteger(Number(valor))
    ? String(Number(valor))
    : Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const linha = (esquerda: string, direita: string, classe = '') =>
  `<div class="row ${classe}"><span>${escapar(esquerda)}</span><span>${escapar(direita)}</span></div>`;

const ESTILO_TERMICO = `  /* A largura física é definida pela bobina configurada no driver. */
  @page { size: auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  /* Negrito: o driver imprime o cupom como imagem e traços finos saem
     claros/falhados no papel térmico. */
  body {
    width: 72mm;
    max-width: calc(100% - 8mm);
    margin: 0 auto;
    padding: 1mm 2mm 2mm;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9px;
    font-weight: 700;
    line-height: 1.3;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .big { font-size: 12px; }
  .muted { margin-top: 2px; }
  .sep { border-top: 1px dashed #000; margin: 4px 0; }
  .sep, .sep-strong { width: 100%; }
  .sep-strong { border-top: 2px solid #000; margin: 4px 0; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; flex-wrap: wrap; }
  .row > span { max-width: 100%; overflow-wrap: anywhere; }
  .cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1mm; text-align: right; }
  .cols span { min-width: 0; overflow-wrap: anywhere; }
  .cols span:first-child { text-align: left; }
  .item { word-break: break-word; }
  .right { text-align: right; }
  .space { height: 4px; }
  .signature { margin-top: 10mm; padding-top: 1mm; border-top: 1px solid #000; text-align: center; }
`;

/** Layout do DAV usado pela loja, em HTML para o driver do Windows. */
export function montarCupomHtml(dados: CupomDados): string {
  const titulo = dados.orcamento
    ? '<div class="center bold">ORÇAMENTO</div>'
    : '<div class="center bold">DAV - Documento Auxiliar de Venda<br>da Nota Fiscal de Consumidor Eletrônica</div>';

  const itens = dados.itens.map((item, index) => `
    <div class="item">${String(index + 1).padStart(3, '0')}&nbsp;&nbsp;${escapar(item.codigo ?? '')}&nbsp;&nbsp;${escapar(item.descricao)}</div>
    <div class="cols"><span>${escapar(`${quantidade(item.quantidade)} x ${item.unidade || 'UN'}`)}</span><span>${escapar(moeda(item.precoUnitario))}</span><span>${escapar(moeda(item.subtotal))}</span></div>
  `).join('');

  const pagamentos = dados.pagamentos.length
    ? linha('FORMA DE PAGAMENTO', 'Valor Pago')
      + dados.pagamentos.map((p) => linha(FORMAS[p.forma] || p.forma, moeda(p.valor))).join('')
    : '';

  const data = `${dados.data.toLocaleDateString('pt-BR')} ${dados.data.toLocaleTimeString('pt-BR')}`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Cupom ${escapar(dados.numero)}</title>
<style>
${ESTILO_TERMICO}</style>
</head>
<body>
  <div class="center bold">${escapar(LOJA.nome)}</div>
  ${linha(`CNPJ.: ${LOJA.cnpj}`, `IE.: ${LOJA.ie}`)}
  <div>End.: ${escapar(LOJA.endereco)}</div>
  <div>Bairro.: ${escapar(LOJA.bairro)}</div>
  <div class="space"></div>
  ${titulo}
  <div class="center muted">Não tem valor fiscal</div>
  <div class="space"></div>
  <div class="big">${dados.orcamento ? 'ORÇAMENTO' : 'DAV'} N°.: ${escapar(dados.numero)}</div>
  <div class="sep"></div>
  <div>ITEM&nbsp;&nbsp;CÓDIGO&nbsp;&nbsp;DESCRIÇÃO</div>
  <div class="cols"><span>QTD&nbsp;&nbsp;UND</span><span>VL.UNIT R$</span><span>TOTAL R$</span></div>
  <div class="sep"></div>
  ${itens}
  <div class="sep-strong"></div>
  ${linha('TOTAL R$.:', moeda(dados.total))}
  ${dados.desconto > 0 ? linha('DESCONTO R$.:', `- ${moeda(dados.desconto)}`) : ''}
  <div class="sep"></div>
  ${linha('PAGAR R$.:', moeda(dados.total - dados.desconto), 'bold')}
  ${pagamentos}
  ${dados.troco > 0 ? linha('TROCO R$.:', moeda(dados.troco)) : ''}
  <div class="sep"></div>
  <div>CLIENTE.: ${escapar((dados.cliente || 'AVULSO').toUpperCase())}</div>
  <div class="right">${escapar(data)}</div>
  <div class="sep"></div>
  <div class="center bold">TERMINAL.: CAIXA OPERADOR.: ${escapar((dados.operador || '1').toUpperCase())}</div>
</body>
</html>`;
}

export type RelatorioFechamento = {
  id: number; operador_nome: string; aberta_em: string; fechada_em: string | null;
  fundo_inicial: string; valor_contado: string | null; diferenca_caixa: string | null; observacoes: string;
  resumo: {
    quantidade_vendas: number; quantidade_canceladas: number; quantidade_orcamentos: number;
    total_bruto: string; descontos: string; total_liquido: string; ticket_medio: string;
    total_sangrias: string; total_suprimentos: string; saldo_esperado: string | null;
    por_forma: Record<string, { valor: string; quantidade: number }>;
    operacoes: { id: number; tipo: string; valor: string; motivo: string; created_at: string }[];
  };
};

export async function imprimirFechamento(relatorio: RelatorioFechamento) {
  await imprimirPeloSistema(montarFechamentoHtml(relatorio));
}

const dataHoraCurta = (valor: string | Date | null) => {
  if (!valor) return '—';
  const data = new Date(valor);
  return `${data.toLocaleDateString('pt-BR')} ${data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

/** Fechamento de caixa detalhado na bobina de 80mm. */
export function montarFechamentoHtml(rel: RelatorioFechamento, impressoEm = new Date()): string {
  const r = rel.resumo;
  const n = (valor: string | number | null) => Number(valor ?? 0);
  const dinheiro = n(r.por_forma.DINHEIRO?.valor);
  const diferenca = n(rel.diferenca_caixa);
  const situacao = diferenca === 0 ? 'CAIXA CONFERE' : diferenca < 0 ? 'FALTA NO CAIXA' : 'SOBRA NO CAIXA';
  const formas = Object.entries(FORMAS).map(([forma, label]) => {
    const item = r.por_forma[forma] ?? { valor: '0', quantidade: 0 };
    return linha(`${label} (${item.quantidade})`, moeda(n(item.valor)));
  }).join('');
  const totalFormas = Object.values(r.por_forma).reduce((total, item) => total + n(item.valor), 0);
  const operacoes = r.operacoes.length
    ? r.operacoes.map(o => linha(
      `${new Date(o.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} ${o.tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento'}${o.motivo ? ` - ${o.motivo}` : ''}`,
      `${o.tipo === 'SANGRIA' ? '- ' : '+ '}${moeda(n(o.valor))}`,
    )).join('')
    : '<div>Nenhuma sangria ou suprimento.</div>';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Fechamento ${escapar(rel.id)}</title>
<style>${ESTILO_TERMICO}</style>
</head>
<body>
  <div class="center bold">${escapar(LOJA.nome)}</div>
  ${LOJA.cnpj ? `<div class="center">CNPJ.: ${escapar(LOJA.cnpj)}</div>` : ''}
  <div class="space"></div>
  <div class="center big">FECHAMENTO DE CAIXA</div>
  <div class="center muted">Não tem valor fiscal</div>
  <div class="sep"></div>
  ${linha('CAIXA N°.:', String(rel.id))}
  ${linha('OPERADOR.:', rel.operador_nome.toUpperCase())}
  ${linha('ABERTURA.:', dataHoraCurta(rel.aberta_em))}
  ${linha('FECHAMENTO.:', dataHoraCurta(rel.fechada_em))}
  <div class="sep-strong"></div>
  <div class="bold">VENDAS</div>
  ${linha('Vendas finalizadas', String(r.quantidade_vendas))}
  ${linha('Vendas canceladas', String(r.quantidade_canceladas))}
  ${r.quantidade_orcamentos ? linha('Orçamentos', String(r.quantidade_orcamentos)) : ''}
  ${linha('Total bruto', moeda(n(r.total_bruto)))}
  ${linha('Descontos', `- ${moeda(n(r.descontos))}`)}
  ${linha('TOTAL LÍQUIDO', moeda(n(r.total_liquido)), 'big')}
  ${linha('Ticket médio', moeda(n(r.ticket_medio)))}
  <div class="sep"></div>
  <div class="bold">RECEBIMENTOS (qtd. vendas)</div>
  ${formas}
  ${linha('TOTAL RECEBIDO', moeda(totalFormas), 'bold')}
  <div class="sep"></div>
  <div class="bold">SANGRIAS E SUPRIMENTOS</div>
  ${operacoes}
  <div class="sep-strong"></div>
  <div class="bold">CONFERÊNCIA DO DINHEIRO</div>
  ${linha('Fundo inicial', moeda(n(rel.fundo_inicial)))}
  ${linha('+ Vendas em dinheiro', moeda(dinheiro))}
  ${linha('+ Suprimentos', moeda(n(r.total_suprimentos)))}
  ${linha('- Sangrias', moeda(n(r.total_sangrias)))}
  <div class="sep"></div>
  ${linha('DINHEIRO ESPERADO', moeda(n(r.saldo_esperado)), 'bold')}
  ${linha('DINHEIRO CONTADO', moeda(n(rel.valor_contado)), 'bold')}
  ${linha('DIFERENÇA', `${diferenca > 0 ? '+ ' : ''}${moeda(diferenca)}`, 'big')}
  <div class="center big">${situacao}</div>
  ${rel.observacoes ? `<div class="sep"></div><div>OBS.: ${escapar(rel.observacoes)}</div>` : ''}
  <div class="sep"></div>
  <div class="center muted">Pix, cartões e fiado não entram no dinheiro físico.</div>
  <div class="signature">Operador</div>
  <div class="signature">Conferente</div>
  <div class="right muted">Impresso em ${escapar(dataHoraCurta(impressoEm))}</div>
</body>
</html>`;
}

/**
 * Imprime num frame fora da tela, sem trocar de página. A interface nativa de
 * impressão é controlada pelo Chrome e pelo driver, não pelo CSS do site.
 */
function imprimirPeloSistema(html: string) {
  return new Promise<void>((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0;';
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    let removed = false;
    const cleanup = () => {
      if (removed) return;
      removed = true;
      clearTimeout(loadTimer);
      clearTimeout(cleanupTimer);
      iframe.remove();
    };
    const fail = (message: string) => { cleanup(); reject(new Error(message)); };
    const loadTimer = setTimeout(() => fail('O documento demorou para carregar. Tente imprimir novamente.'), 30_000);

    iframe.onload = async () => {
      iframe.onload = null;
      const janela = iframe.contentWindow;
      if (!janela) {
        fail('Não foi possível preparar a impressão.');
        return;
      }
      try {
        // Espera as páginas rasterizadas antes de medir o comprimento da bobina.
        await Promise.all(Array.from(janela.document.images).map(image => image.decode()));
        await janela.document.fonts?.ready;
        if (removed) return;
        clearTimeout(loadTimer);
        const pixels = Math.max(janela.document.body.scrollHeight, janela.document.body.getBoundingClientRect().height);
        const heightMm = Math.max(10, Math.ceil(pixels * 25.4 / 96 + 1));
        const pageSize = janela.document.createElement('style');
        pageSize.textContent = `@page { size: 80mm ${heightMm}mm; margin: 0; }`;
        janela.document.head.appendChild(pageSize);
        janela.addEventListener('afterprint', () => { cleanupTimer = setTimeout(cleanup, 1000); }, { once: true });
        janela.focus();
        janela.print();
        // Mantém o conteúdo disponível enquanto o navegador prepara a impressão.
        cleanupTimer = setTimeout(cleanup, 60_000);
        resolve();
      } catch {
        fail('Não foi possível acionar a impressão. Tente novamente.');
      }
    };
    iframe.onerror = () => fail('Não foi possível carregar o documento para impressão.');
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  });
}
