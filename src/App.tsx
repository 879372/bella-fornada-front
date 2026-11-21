import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useAuthStore } from './store/authStore';
import PageLoader from './components/PageLoader';
import api from './lib/api';
import './index.css';

const Login = lazy(() => import('./pages/Login/Login'));
const Layout = lazy(() => import('./components/Layout'));
const Dashboard = lazy(() => import('./pages/Dashboard/Dashboard'));
const Produtos = lazy(() => import('./pages/Produtos/Produtos.tsx'));
const Grupos = lazy(() => import('./pages/Produtos/Grupos.tsx'));
const Clientes = lazy(() => import('./pages/Clientes/Clientes.tsx'));
const PDV = lazy(() => import('./pages/PDV/PDV.tsx'));
const Financeiro = lazy(() => import('./pages/Financeiro/Financeiro.tsx'));
const Compras = lazy(() => import('./pages/Compras/Compras.tsx'));
const Fechamentos = lazy(() => import('./pages/Fechamentos/Fechamentos.tsx'));
const Relatorios = lazy(() => import('./pages/Relatorios/Relatorios.tsx'));
const Vendas = lazy(() => import('./pages/Vendas/Vendas.tsx'));
const Estoque = lazy(() => import('./pages/Estoque/Estoque.tsx'));
const Delivery = lazy(() => import('./pages/Delivery/Delivery.tsx'));
const Producao = lazy(() => import('./pages/Producao/Producao.tsx'));
const Usuarios = lazy(() => import('./pages/Usuarios/Usuarios.tsx'));
const Fiscal = lazy(() => import('./pages/Fiscal/Fiscal.tsx'));
const ConfiguracaoFiscal = lazy(() => import('./pages/Fiscal/ConfiguracaoFiscal.tsx'));
const Balancas = lazy(() => import('./pages/Balancas/Balancas.tsx'));
const OnlineMenu = lazy(() => import('./online/OnlineMenu.tsx'));
const OrderTracking = lazy(() => import('./online/OrderTracking.tsx'));

interface PrivateRouteProps {
  children: React.ReactNode;
}

/** Painel administrativo: o caixa é sempre levado de volta ao PDV. */
const PainelRoute = ({ children }: PrivateRouteProps) => {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (user?.somente_pdv) return <Navigate to="/pdv" replace />;
  return <>{children}</>;
};

const PdvRoute = ({ children }: PrivateRouteProps) => {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated ? <>{children}</> : <Navigate to="/caixa" />;
};

/** Atualiza o papel salvo no navegador (ex.: login feito antes de o usuário virar caixa). */
const AtualizarPerfil = () => {
  const isAuthenticated = useAuthStore(state => state.isAuthenticated);
  const setUser = useAuthStore(state => state.setUser);
  useEffect(() => {
    if (!isAuthenticated) return;
    api.get('/auth/me/').then(({ data }) => setUser(data)).catch(() => undefined);
  }, [isAuthenticated, setUser]);
  return null;
};

const OrderTrackingRoute = () => {
  const { token = '' } = useParams();
  return <OrderTracking token={token} />;
};

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" richColors closeButton />
      <AtualizarPerfil />
      <Suspense fallback={<PageLoader label="Abrindo módulo..." />}>
       <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/caixa" element={<Login modo="pdv" />} />

        {/* Cardápio online e acompanhamento de pedido: públicos, sem login */}
        <Route path="/cardapio" element={<OnlineMenu />} />
        <Route path="/acompanhar/:token" element={<OrderTrackingRoute />} />

        <Route path="/" element={<PainelRoute><Layout /></PainelRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="produtos" element={<Produtos />} />
          <Route path="produtos/grupos" element={<Grupos />} />
          <Route path="estoque" element={<Estoque />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="financeiro" element={<Financeiro />} />
          <Route path="compras" element={<Compras />} />
          <Route path="fechamentos" element={<Fechamentos />} />
          <Route path="relatorios" element={<Relatorios />} />
          <Route path="vendas" element={<Vendas />} />
          <Route path="delivery" element={<Delivery />} />
          <Route path="producao" element={<Producao />} />
          <Route path="usuarios" element={<Usuarios />} />
          <Route path="fiscal" element={<Fiscal />} />
          <Route path="fiscal/configuracao" element={<ConfiguracaoFiscal />} />
          <Route path="balancas" element={<Balancas />} />
        </Route>

        <Route path="/pdv" element={<PdvRoute><PDV /></PdvRoute>} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
       </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
