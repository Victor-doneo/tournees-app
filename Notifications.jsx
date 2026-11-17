import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import { TYPES, STATUS_META } from './Demandes'
import { fetchRecentNotifications, markAllDemandesRead, notifyDemandeNotifsChanged } from './demandeNotifications'

// Page « Notifications » : historique des réponses et changements de statut sur les demandes.
export default function Notifications() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const demandesPath = profile?.role === 'admin' ? '/admin/demandes' : '/partner'
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // 'all' | 'unread'

  async function load() {
    setRows(await fetchRecentNotifications(200))
    setLoading(false)
  }
  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    window.addEventListener('demande-notifs-changed', load)
    return () => { clearInterval(t); window.removeEventListener('demande-notifs-changed', load) }
  }, [])

  const unreadCount = rows.filter(r => !r.read_at).length
  const shown = filter === 'unread' ? rows.filter(r => !r.read_at) : rows

  async function toggleRead(n, e) {
    e.stopPropagation()
    const { error } = await supabase.from('demande_notifications')
      .update({ read_at: n.read_at ? null : new Date().toISOString() }).eq('id', n.id)
    if (error) return toast.error('Erreur : ' + error.message)
    notifyDemandeNotifsChanged()
  }

  return (
    <>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="page-title">Notifications</h2>
            <p className="page-subtitle">Réponses et mises à jour sur les demandes</p>
          </div>
          {unreadCount > 0 && (
            <button className="btn btn-secondary" onClick={markAllDemandesRead}>
              <CheckCheck size={15} /> Tout marquer comme lu ({unreadCount})
            </button>
          )}
        </div>
      </div>
      <div className="page-body">
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter('all')}>Toutes</button>
          <button className={`btn btn-sm ${filter === 'unread' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter('unread')}>Non lues ({unreadCount})</button>
        </div>

        <div className="card">
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--gray-400)' }}>Chargement…</div>
          ) : shown.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray-400)' }}>
              <Bell size={28} style={{ opacity: 0.4 }} />
              <p style={{ marginTop: 8 }}>{filter === 'unread' ? 'Aucune notification non lue' : 'Aucune notification'}</p>
            </div>
          ) : shown.map(n => {
            const d = n.demande
            const t = d ? (TYPES[d.type] || TYPES.autre) : null
            return (
              <div key={n.id} onClick={() => d && navigate(`${demandesPath}?open=${n.demande_id}`)}
                style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 16px', borderBottom: '1px solid var(--gray-100)', cursor: d ? 'pointer' : 'default', background: n.read_at ? undefined : 'rgba(239,68,68,0.06)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, marginTop: 7, flexShrink: 0, background: n.read_at ? 'transparent' : '#ef4444' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--gray-500)' }}>
                    <strong style={{ color: 'var(--gray-800)' }}>{n.actor?.full_name || n.actor?.email || '—'}</strong>
                    {n.kind === 'statut' ? ' a mis à jour la demande' : ' a répondu à la demande'}
                    {d && <> · <span className={`badge ${t.badge}`}>{t.label}</span>{(d.bp || []).length > 0 && <> · <code>{d.bp.slice(0, 2).join(', ')}{d.bp.length > 2 ? '…' : ''}</code></>}</>}
                    {!d && ' (supprimée)'}
                  </div>
                  <div style={{ fontSize: 14, marginTop: 3, fontWeight: n.read_at ? 400 : 600 }}>
                    {n.kind === 'statut' ? `Nouveau statut : ${(STATUS_META[n.message] || {}).label || n.message}` : n.message}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--gray-400)', whiteSpace: 'nowrap' }}>{new Date(n.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                  <button className="btn btn-sm btn-secondary" style={{ marginTop: 6, fontSize: 11 }} onClick={e => toggleRead(n, e)}>
                    {n.read_at ? 'Marquer non lu' : 'Marquer lu'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
