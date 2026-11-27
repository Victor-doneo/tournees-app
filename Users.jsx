import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import { Plus, X, KeyRound, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'

const ROLE_LABELS = { admin: 'Administrateur', operator: 'Opérateur', partner: 'CCHEZVOUS', carrier: 'Transporteur' }
const EMPTY_FORM = { email: '', full_name: '', role: 'operator', password: '', suppliers: [], can_view_tour_tracking: false, can_manage_loading_plan: false }

export default function Users() {
  const { profile } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [allSuppliers, setAllSuppliers] = useState([])
  const [audit, setAudit] = useState([])
  const [editSup, setEditSup] = useState(null) // { user, list }
  const [pwd, setPwd] = useState(null) // { user, value }

  useEffect(() => { fetchUsers(); fetchSuppliers(); fetchAudit() }, [])

  async function fetchUsers() {
    const { data } = await supabase.from('users').select('*').order('created_at', { ascending: false })
    setUsers(data || [])
    setLoading(false)
  }
  async function fetchSuppliers() {
    const { data } = await supabase.from('tours_references').select('name_supplier')
    setAllSuppliers([...new Set((data || []).map(r => (r.name_supplier || '').trim()).filter(Boolean))].sort())
  }
  async function fetchAudit() {
    const { data } = await supabase.from('access_audit').select('*').order('at', { ascending: false }).limit(40)
    setAudit(data || [])
  }

  // Appel de la fonction serveur admin-users (rôle posé côté serveur). null si la fonction n'est pas déployée.
  async function callAdmin(body) {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || '', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 404) return null
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(out.error || `Erreur ${res.status}`)
    return out
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (form.role === 'carrier' && !form.suppliers.length) return toast.error('Choisis au moins un fournisseur pour un compte transporteur')
    setSaving(true)
    try {
      const out = await callAdmin({ action: 'create', ...form })
      if (out === null) {
        // Repli (fonction admin-users pas encore déployée) : ancienne méthode, réservée aux rôles sans fournisseur
        if (form.role === 'carrier') throw new Error('Déploie d\'abord la fonction admin-users (Supabase > Edge Functions) pour créer un compte transporteur')
        const { data, error } = await supabase.auth.signUp({ email: form.email, password: form.password, options: { data: { full_name: form.full_name }, emailRedirectTo: window.location.origin } })
        if (error) throw error
        if (!data.user) throw new Error('Utilisateur non créé')
        await new Promise(r => setTimeout(r, 1000))
        const patch = { role: form.role, full_name: form.full_name, can_view_tour_tracking: form.role === 'partner' && form.can_view_tour_tracking, can_manage_loading_plan: form.role === 'partner' && form.can_manage_loading_plan }
        const { error: ue } = await supabase.from('users').update(patch).eq('id', data.user.id)
        if (ue) await supabase.from('users').upsert({ id: data.user.id, email: form.email, active: true, ...patch })
        toast('Compte créé avec l\'ancienne méthode : déploie la fonction admin-users pour sécuriser la création', { icon: '⚠️' })
      } else toast.success('Utilisateur créé avec succès')
      setShowModal(false); setForm(EMPTY_FORM)
      fetchUsers(); fetchAudit()
    } catch (err) {
      toast.error('Erreur : ' + err.message)
    } finally { setSaving(false) }
  }

  async function patchUser(u, patch, okMsg) {
    const { error } = await supabase.from('users').update(patch).eq('id', u.id)
    if (error) return toast.error('Erreur : ' + error.message)
    toast.success(okMsg)
    fetchUsers(); fetchAudit()
  }
  const toggleActive = u => patchUser(u, { active: !u.active }, u.active ? 'Utilisateur désactivé' : 'Utilisateur activé')
  const toggleLoadingPlan = u => patchUser(u, { can_manage_loading_plan: !u.can_manage_loading_plan }, u.can_manage_loading_plan ? 'Accès au plan de chargement retiré' : 'Accès au plan de chargement accordé')
  const toggleTracking = u => patchUser(u, { can_view_tour_tracking: !u.can_view_tour_tracking }, u.can_view_tour_tracking ? 'Accès au suivi des tournées retiré' : 'Accès au suivi des tournées accordé')
  const updateRole = (u, role) => patchUser(u, { role }, 'Rôle mis à jour')

  async function saveSuppliers() {
    await patchUser(editSup.user, { suppliers: editSup.list }, 'Fournisseurs mis à jour')
    setEditSup(null)
  }
  async function savePassword(e) {
    e.preventDefault()
    try {
      const out = await callAdmin({ action: 'set_password', user_id: pwd.user.id, password: pwd.value })
      if (out === null) throw new Error('Déploie d\'abord la fonction admin-users (Supabase > Edge Functions)')
      toast.success('Mot de passe modifié'); setPwd(null)
    } catch (err) { toast.error('Erreur : ' + err.message) }
  }
  async function removeUser(u) {
    if (!window.confirm(`Supprimer définitivement le compte ${u.email} ? (préfère « Désactiver » pour garder l'historique)`)) return
    try {
      const out = await callAdmin({ action: 'delete', user_id: u.id })
      if (out === null) throw new Error('Déploie d\'abord la fonction admin-users (Supabase > Edge Functions)')
      toast.success('Compte supprimé'); fetchUsers(); fetchAudit()
    } catch (err) { toast.error('Erreur : ' + err.message) }
  }

  const supChips = useMemo(() => s => (s || []).length ? (s || []).join(', ') : 'Aucun fournisseur : aucun accès', [])
  const roleOptions = Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)
  const SupList = ({ value, onChange }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflow: 'auto', border: '1px solid var(--gray-200)', borderRadius: 6, padding: 10 }}>
      {allSuppliers.length === 0 && <span style={{ fontSize: 13, color: 'var(--gray-400)' }}>Aucun fournisseur renseigné dans « Tournées de référence »</span>}
      {allSuppliers.map(s => (
        <label key={s} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={value.includes(s)} onChange={e => onChange(e.target.checked ? [...value, s] : value.filter(x => x !== s))} />{s}
        </label>
      ))}
    </div>
  )

  return (
    <>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="page-title">Utilisateurs</h2>
            <p className="page-subtitle">{users.length} comptes · Administrateur, Opérateur, CCHEZVOUS (partenaire) et Transporteur (accès limité à ses données qualité)</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={15} /> Nouvel utilisateur</button>
        </div>
      </div>

      <div className="page-body">
        <div className="card">
          {loading ? <div className="loading-center"><div className="spinner dark" /></div> : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Nom</th><th>Email</th><th>Rôle</th><th>Accès</th><th>Statut</th><th>Créé le</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0, fontFamily: 'var(--font-display)' }}>
                            {(u.full_name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <span style={{ fontWeight: 500 }}>{u.full_name || '—'}</span>
                        </div>
                      </td>
                      <td style={{ color: 'var(--gray-500)' }}>{u.email}</td>
                      <td>
                        <select value={u.role} onChange={e => updateRole(u, e.target.value)} disabled={u.id === profile?.id} aria-label={`Rôle de ${u.email}`}
                          style={{ border: '1px solid var(--gray-200)', borderRadius: '6px', padding: '4px 8px', fontSize: '13px', background: 'white', color: 'var(--gray-700)', cursor: 'pointer' }}>
                          {roleOptions}
                        </select>
                      </td>
                      <td style={{ fontSize: 13 }}>
                        {u.role === 'partner' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}><input type="checkbox" checked={!!u.can_manage_loading_plan} onChange={() => toggleLoadingPlan(u)} /> Plan de chargement</label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}><input type="checkbox" checked={!!u.can_view_tour_tracking} onChange={() => toggleTracking(u)} /> Suivi, Dashboard Transport, colis non rapatriés</label>
                          </div>
                        )}
                        {u.role === 'carrier' && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ color: (u.suppliers || []).length ? 'var(--gray-700)' : 'var(--red, #b91c1c)' }}>{supChips(u.suppliers)}</span>
                            <button className="btn btn-ghost btn-sm" onClick={() => setEditSup({ user: u, list: u.suppliers || [] })}>Modifier</button>
                          </div>
                        )}
                        {u.role === 'admin' && <span style={{ color: 'var(--gray-400)' }}>Tout</span>}
                        {u.role === 'operator' && <span style={{ color: 'var(--gray-300)' }}>—</span>}
                      </td>
                      <td><span className={`badge ${u.active ? 'badge-green' : 'badge-gray'}`}>{u.active ? 'Actif' : 'Inactif'}</span></td>
                      <td style={{ color: 'var(--gray-400)', fontSize: '13px' }}>{new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(u)} disabled={u.id === profile?.id}>{u.active ? 'Désactiver' : 'Activer'}</button>
                        <button className="btn btn-ghost btn-sm" title="Changer le mot de passe" aria-label={`Changer le mot de passe de ${u.email}`} onClick={() => setPwd({ user: u, value: '' })}><KeyRound size={14} /></button>
                        <button className="btn btn-ghost btn-sm" title="Supprimer le compte" aria-label={`Supprimer ${u.email}`} onClick={() => removeUser(u)} disabled={u.id === profile?.id}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ padding: '12px 16px', fontWeight: 700 }}>Historique des modifications d'accès</div>
          {audit.length === 0 ? <div style={{ padding: '0 16px 16px', color: 'var(--gray-400)', fontSize: 13 }}>Aucune modification enregistrée (migration <code>supabase_migration_acces_v2.sql</code> lancée ?)</div> : (
            <div className="table-wrapper"><table><thead><tr><th>Date</th><th>Par</th><th>Compte</th><th>Modification</th></tr></thead><tbody>
              {audit.map(a => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{new Date(a.at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                  <td style={{ fontSize: 13 }}>{a.actor_email || 'système'}</td>
                  <td style={{ fontSize: 13 }}>{a.user_email}</td>
                  <td style={{ fontSize: 13 }}>{a.change}</td>
                </tr>
              ))}
            </tbody></table></div>
          )}
        </div>
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 className="modal-title">Nouvel utilisateur</h3>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)} aria-label="Fermer"><X size={16} /></button>
              </div>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-group"><label className="form-label">Nom complet</label>
                  <input className="form-input" required value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Prénom Nom" /></div>
                <div className="form-group"><label className="form-label">Email</label>
                  <input className="form-input" type="email" required value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@exemple.com" /></div>
                <div className="form-group"><label className="form-label">Mot de passe temporaire</label>
                  <input className="form-input" type="password" required minLength={8} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="8 caractères minimum" /></div>
                <div className="form-group"><label className="form-label">Rôle</label>
                  <select className="form-input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>{roleOptions}</select></div>
                {form.role === 'partner' && (
                  <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                    <label style={{ display: 'flex', gap: 8, cursor: 'pointer' }}><input type="checkbox" checked={form.can_manage_loading_plan} onChange={e => setForm(f => ({ ...f, can_manage_loading_plan: e.target.checked }))} /> Plan de chargement</label>
                    <label style={{ display: 'flex', gap: 8, cursor: 'pointer' }}><input type="checkbox" checked={form.can_view_tour_tracking} onChange={e => setForm(f => ({ ...f, can_view_tour_tracking: e.target.checked }))} /> Suivi des tournées, Dashboard Transport, colis non rapatriés</label>
                  </div>
                )}
                {form.role === 'carrier' && (
                  <div className="form-group"><label className="form-label">Fournisseurs visibles (ses données uniquement)</label>
                    <SupList value={form.suppliers} onChange={v => setForm(f => ({ ...f, suppliers: v }))} /></div>
                )}
                <div style={{ padding: '12px 14px', background: 'var(--blue-light)', borderRadius: 'var(--radius-sm)', fontSize: '13px', color: '#1e40af' }}>
                  Le compte est actif immédiatement avec le mot de passe temporaire. Communique-le par un canal sûr.
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Annuler</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? <><div className="spinner" /> Création...</> : 'Créer l\'utilisateur'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editSup && (
        <div className="modal-backdrop" onClick={() => setEditSup(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3 className="modal-title">Fournisseurs de {editSup.user.full_name || editSup.user.email}</h3></div>
            <div className="modal-body"><SupList value={editSup.list} onChange={list => setEditSup(s => ({ ...s, list }))} /></div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setEditSup(null)}>Annuler</button>
              <button type="button" className="btn btn-primary" onClick={saveSuppliers}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {pwd && (
        <div className="modal-backdrop" onClick={() => setPwd(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <form onSubmit={savePassword}>
              <div className="modal-header"><h3 className="modal-title">Nouveau mot de passe — {pwd.user.email}</h3></div>
              <div className="modal-body"><input className="form-input" type="password" required minLength={8} autoFocus value={pwd.value} onChange={e => setPwd(p => ({ ...p, value: e.target.value }))} placeholder="8 caractères minimum" aria-label="Nouveau mot de passe" /></div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setPwd(null)}>Annuler</button>
                <button type="submit" className="btn btn-primary">Modifier</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
