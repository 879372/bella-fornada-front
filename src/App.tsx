import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { Toaster } from 'sonner';
import { useAuthStore } from './store/authStore';
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
const Relatorios = lazy(() => import('./pages/Relatorios/Relatorios.tsx'));
const Vendas = lazy(() => import('./pages/Vendas/Vendas.tsx'));
const Estoque = lazy(() => import('./pages/Estoque/Estoque.tsx'));
const Delivery = lazy(() => import('./pages/Delivery/Delivery.tsx'));
const Producao = lazy(() => import('./pages/Producao/Producao.tsx'));
const Usuarios = lazy(() => import('./pages/Usuarios/Usuarios.tsx'));
const OnlineMenu = lazy(() => import('./online/OnlineMenu.tsx'));
const OrderTracking = lazy(() => import('./online/OrderTracking.tsx'));

interface PrivateRouteProps {
  children: React.ReactNode;
}

const PrivateRoute = ({ children }: PrivateRouteProps) => {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
};

const OrderTrackingRoute = () => {
  const { token = '' } = useParams();
  return <OrderTracking token={token} />;
};

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" richColors closeButton />
      <Suspense fallback={<div className="loading" style={{ minHeight: '100vh' }}>Carregando sistema...</div>}>
       <Routes>
        <Route path="/login" element={<Login />} />

        {/* Cardápio online e acompanhamento de pedido: públicos, sem login */}
        <Route path="/cardapio" element={<OnlineMenu />} />
        <Route path="/acompanhar/:token" element={<OrderTrackingRoute />} />

        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="produtos" element={<Produtos />} />
          <Route path="produtos/grupos" element={<Grupos />} />
          <Route path="estoque" element={<Estoque />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="financeiro" element={<Financeiro />} />
          <Route path="compras" element={<Compras />} />
          <Route path="relatorios" element={<Relatorios />} />
          <Route path="vendas" element={<Vendas />} />
          <Route path="delivery" element={<Delivery />} />
          <Route path="producao" element={<Producao />} />
          <Route path="usuarios" element={<Usuarios />} />
        </Route>

        <Route path="/pdv" element={<PrivateRoute><PDV /></PrivateRoute>} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
       </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
