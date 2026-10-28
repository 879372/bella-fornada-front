import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, ShieldCheck, UserRound, X } from 'lucide-react';
import { toast } from 'sonner';

import Modal from '../../components/Modal';
import api from '../../lib/api';

type Usuario = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  papel: 'ADMIN' | 'GERENTE' | 'CAIXA' | 'PRODUCAO' | 'ENTREGADOR';
  papel_label: string;
  telefone: string;
  ativo: boolean;
  last_login: string | null;
};

const empty = {
  username: '', first_name: '', last_name: '', email: '', telefone: '',
  papel: 'CAIXA' as Usuario['papel'], ativo: true, password: '',
};

export default function Usuarios() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Usuario | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);

  const { data: users = [], isLoading } = useQuery<Usuario[]>({
    queryKey: ['usuarios'],
    queryFn: async () => {
      const { data } = await api.get('/usuarios/');
      return Array.isArray(data) ? data : data.results || [];
    },
  });

  const close = () => { setOpen(false); setEditing(null); setForm(empty); };
  const edit = (user: Usuario) => {
    setEditing(user);
    setForm({
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      telefone: user.telefone,
      papel: user.papel,
      ativo: user.ativo,
      password: '',
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, password: form.password || undefined };
      return editing ? api.patch(`/usuarios/${editing.id}/`, payload) : api.post('/usuarios/', payload);
    },
    onSuccess: () => {
      toast.success(editing ? 'Usuário atualizado.' : 'Usuário criado.');
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      close();
    },
  });

  const submit = (event: FormEvent) => { event.preventDefault(); save.mutate(); };

  return <div className="animate-in">
    <div className="page-header page-header-row"><div><h1 className="page-title">Equipe e acessos</h1><p className="page-subtitle">Perfis separados para gestão, caixa, produção e entrega</p></div><button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={17} /> Novo usuário</button></div>
    <div className="card table-card">
      {isLoading ? <div className="loading">Carregando equipe...</div> : !users.length ? <div className="empty-state"><UserRound size={44} /><h3>Nenhum usuário cadastrado</h3></div> : <div className="table-wrapper"><table className="table"><thead><tr><th>Usuário</th><th>Nome</th><th>Perfil</th><th>Contato</th><th>Status</th><th>Último acesso</th><th>Ação</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.username}</strong></td><td>{`${user.first_name} ${user.last_name}`.trim() || '—'}</td><td><span className="inline-icon"><ShieldCheck size={15} /> {user.papel_label}</span></td><td>{user.telefone || user.email || '—'}</td><td><span className={`badge ${user.ativo ? 'badge-green' : 'badge-red'}`}>{user.ativo ? 'Ativo' : 'Inativo'}</span></td><td>{user.last_login ? new Date(user.last_login).toLocaleString('pt-BR') : 'Nunca'}</td><td><button className="btn btn-ghost btn-sm" onClick={() => edit(user)}><Pencil size={14} /> Editar</button></td></tr>)}</tbody></table></div>}
    </div>

    {open && <Modal onClose={close} labelledBy="user-modal-title" panelClassName="modal-content modal-panel">
      <div className="modal-header"><div><h2 id="user-modal-title" className="modal-title">{editing ? 'Editar usuário' : 'Novo usuário'}</h2><p className="modal-subtitle">As permissões são verificadas no servidor.</p></div><button className="btn-icon" onClick={close}><X size={20} /></button></div>
      <form onSubmit={submit}><div className="form-grid-2">
        <label className="form-group"><span className="form-label">Usuário *</span><input className="input" required autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
        <label className="form-group"><span className="form-label">Perfil *</span><select className="input" value={form.papel} onChange={(event) => setForm({ ...form, papel: event.target.value as Usuario['papel'] })}><option value="ADMIN">Administrador</option><option value="GERENTE">Gerente</option><option value="CAIXA">Caixa</option><option value="PRODUCAO">Produção</option><option value="ENTREGADOR">Entregador</option></select></label>
        <label className="form-group"><span className="form-label">Nome</span><input className="input" value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} /></label>
        <label className="form-group"><span className="form-label">Sobrenome</span><input className="input" value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} /></label>
        <label className="form-group"><span className="form-label">E-mail</span><input className="input" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label className="form-group"><span className="form-label">Telefone</span><input className="input" value={form.telefone} onChange={(event) => setForm({ ...form, telefone: event.target.value })} /></label>
        <label className="form-group form-span-2"><span className="form-label">{editing ? 'Nova senha (deixe vazio para manter)' : 'Senha inicial *'}</span><input className="input" type="password" minLength={8} required={!editing} autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
        <label className="form-group form-span-2" style={{ display: 'flex', alignItems: 'center', gap: 10 }}><input type="checkbox" checked={form.ativo} onChange={(event) => setForm({ ...form, ativo: event.target.checked })} /><span>Usuário ativo</span></label>
      </div><div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={close}>Cancelar</button><button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Salvando...' : 'Salvar usuário'}</button></div></form>
    </Modal>}
  </div>;
}

