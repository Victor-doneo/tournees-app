import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'

export default function Users() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ email: '', full_name: '', role: 'operator', password: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchUsers() }, [])

  async function fetchUsers() {
    const { data } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false })
    setUsers(data || [])
    setLoading(false)
  }

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    try {
      // Créer le compte via signUp (fonctionne côté client)
      const { data, error } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: {
            full_name: form.full_name,
            role: form.role,
          },
          emailRedirectTo: window.location.origin,
        },
      })

      if (error) throw error
      if (!data.user) throw new Error('Utilisateur non créé')

      // Mettre à jour le rôle et le nom dans la table users
      // (le trigger handle_new_user crée la ligne, on la met à jour)
      await new Promise(r => setTimeout(r, 1000)) // laisser le trigger s'exécuter

      const { error: updateError } = await supabase
        .from('users')
        .update({ role: form.role, full_name: form.full_name })
        .eq('id', data.user.id)

      if (updateError) {
        // Si le trigger n'a pas encore créé la ligne, on la crée manuellement
        await supabase.from('users').upsert({
          id: data.user.id,
          email: form.email,
          full_name: form.full_name,
          role: form.role,
          active: true,
        })
      }

      toast.success('Utilisateur créé avec succès')
      setShowModal(false)
      setForm({ email: '', full_name: '', role: 'operator', password: '' })
      fetchUsers()
    } catch (err) {
      toast.error('Erreur : ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(user) {
    const { error } = await supabase
      .from('users')
      .update({ active: !user.active })
      .eq('id', user.id)
    if (error) return toast.error('Erreur')
    toast.success(user.active ? 'Utilisateur désactivé' : 'Utilisateur activé')
    fetchUsers()
  }

  async function updateRole(userId, role) {
    const { error } = await supabase.from('users').update({ role }).eq('id', userId)
    if (error) return toast.error('Erreur')
    toast.success('Rôle mis à jour')
    fetchUsers()
  }

  return (
    <>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="page-title">Utilisateurs</h2>
            <p className="page-subtitle">{users.length} comptes</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={15} /> Nouvel utilisateur
          </button>
        </div>
      </div>

      <div className="page-body">
        <div className="card">
          {loading ? (
            <div className="loading-center"><div className="spinner dark" /></div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Email</th>
                    <th>Rôle</th>
                    <th>Statut</th>
                    <th>Créé le</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: 'var(--accent)', color: 'white',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '12px', fontWeight: 700, flexShrink: 0,
                            fontFamily: 'var(--font-display)',
                          }}>
                            {(u.full_name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <span style={{ fontWeight: 500 }}>{u.full_name || '—'}</span>
                        </div>
                      </td>
                      <td style={{ color: 'var(--gray-500)' }}>{u.email}</td>
                      <td>
                        <select
                          value={u.role}
                          onChange={e => updateRole(u.id, e.target.value)}
                          style={{
                            border: '1px solid var(--gray-200)', borderRadius: '6px',
                            padding: '4px 8px', fontSize: '13px', background: 'white',
                            color: 'var(--gray-700)', cursor: 'pointer',
                          }}
                        >
                          <option value="operator">Opérateur</option>
                          <option value="admin">Administrateur</option>
                        </select>
                      </td>
                      <td>
                        <span className={`badge ${u.active ? 'badge-green' : 'badge-gray'}`}>
                          {u.active ? 'Actif' : 'Inactif'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--gray-400)', fontSize: '13px' }}>
                        {new Date(u.created_at).toLocaleDateString('fr-FR')}
                      </td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(u)}>
                          {u.active ? 'Désactiver' : 'Activer'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal création */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 className="modal-title">Nouvel utilisateur</h3>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>
                  <X size={16} />
                </button>
              </div>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Nom complet</label>
                  <input
                    className="form-input" required
                    value={form.full_name}
                    onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                    placeholder="Prénom Nom"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input
                    className="form-input" type="email" required
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="email@exemple.com"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Mot de passe temporaire</label>
                  <input
                    className="form-input" type="password" required
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="Min. 6 caractères"
                    minLength={6}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Rôle</label>
                  <select
                    className="form-input"
                    value={form.role}
                    onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  >
                    <option value="operator">Opérateur</option>
                    <option value="admin">Administrateur</option>
                  </select>
                </div>

                <div style={{
                  padding: '12px 14px', background: 'var(--blue-light)',
                  borderRadius: 'var(--radius-sm)', fontSize: '13px', color: '#1e40af'
                }}>
                  ℹ️ L'utilisateur recevra un email de confirmation. Il pourra se connecter immédiatement avec le mot de passe temporaire.
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <><div className="spinner" /> Création...</> : 'Créer l\'utilisateur'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
