export type Totals = { quantidade: number; valor: string };

export default function TotalsCards({ items, loading, error }: {
  items: { label: string; totals?: Totals }[];
  loading: boolean;
  error: boolean;
}) {
  return <section aria-label="Totalizadores" aria-busy={loading} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
    {items.map(({ label, totals }) => <div className="card" key={label} style={{ padding: 18 }}>
      <div className="kpi-label">{label}</div>
      <strong style={{ display: 'block', fontSize: '1.4rem', margin: '8px 0' }}>{error ? 'Indisponível' : loading || !totals ? '—' : Number(totals.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
      <small style={{ color: 'var(--text-muted)' }}>{error ? 'Não foi possível carregar os totais.' : loading || !totals ? 'Carregando...' : `${totals.quantidade.toLocaleString('pt-BR')} registro(s)`}</small>
    </div>)}
  </section>;
}
