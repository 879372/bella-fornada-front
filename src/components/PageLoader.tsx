type PageLoaderProps = { label?: string; };

/** Keeps the application layout stable while a lazy route is downloaded. */
export default function PageLoader({ label = 'Carregando página...' }: PageLoaderProps) {
  return <main className="page-loader" aria-busy="true" aria-live="polite"><span className="sr-only">{label}</span><div className="page-loader-heading"><span className="skeleton-shimmer" /><span className="skeleton-shimmer" /></div><div className="page-loader-cards" aria-hidden="true">{[1, 2, 3, 4].map((item) => <div className="page-loader-card skeleton-shimmer" key={item} />)}</div><div className="page-loader-content skeleton-shimmer" aria-hidden="true" /></main>;
}
