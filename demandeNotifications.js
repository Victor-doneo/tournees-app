// Notifications sur les demandes : réponses ou changements de statut non lus.
// Le compteur est rafraîchi toutes les 30 s, au retour sur l'onglet, et dès qu'une
// action locale (lecture d'une demande) le demande via l'événement ci-dessous.
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'

const EVENT = 'demande-notifs-changed'
const POLL_MS = 30000

export function notifyDemandeNotifsChanged() {
  window.dispatchEvent(new Event(EVENT))
}

// Marque comme lues toutes les notifications d'une demande (à l'ouverture de la demande)
export async function markDemandeRead(demandeId) {
  const { error } = await supabase
    .from('demande_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('demande_id', demandeId)
    .is('read_at', null)
  if (!error) notifyDemandeNotifsChanged()
}

export async function markAllDemandesRead() {
  const { error } = await supabase
    .from('demande_notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
  if (!error) notifyDemandeNotifsChanged()
}

/**
 * Renvoie { total, byDemande } : nombre de notifications non lues, et par demande.
 * Avec { toastOnNew: true }, affiche une bulle à l'arrivée d'une nouvelle réponse.
 */
export function useDemandeNotifications({ toastOnNew = false } = {}) {
  const { user } = useAuth()
  const [state, setState] = useState({ total: 0, byDemande: {} })
  const seen = useRef(null) // ids déjà connus (pour ne notifier que les nouvelles)

  useEffect(() => {
    if (!user) return
    let stopped = false

    async function load() {
      const { data, error } = await supabase
        .from('demande_notifications')
        .select('id, demande_id, kind, message, actor:actor_id(full_name, email)')
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(500)
      if (stopped || error) return

      const rows = data || []
      const byDemande = {}
      rows.forEach(r => { byDemande[r.demande_id] = (byDemande[r.demande_id] || 0) + 1 })
      setState({ total: rows.length, byDemande })

      if (toastOnNew) {
        const ids = new Set(rows.map(r => r.id))
        if (seen.current) {
          const fresh = rows.filter(r => !seen.current.has(r.id))
          if (fresh.length === 1) {
            const r = fresh[0]
            const who = r.actor?.full_name || r.actor?.email || 'Quelqu\'un'
            toast(r.kind === 'statut' ? `${who} a mis à jour une demande` : `${who} a répondu à une demande`, { icon: '💬' })
          } else if (fresh.length > 1) {
            toast(`${fresh.length} nouvelles réponses sur vos demandes`, { icon: '💬' })
          }
        }
        seen.current = ids
      }
    }

    load()
    const timer = setInterval(load, POLL_MS)
    const onFocus = () => load()
    window.addEventListener(EVENT, onFocus)
    window.addEventListener('focus', onFocus)
    return () => {
      stopped = true
      clearInterval(timer)
      window.removeEventListener(EVENT, onFocus)
      window.removeEventListener('focus', onFocus)
    }
  }, [user?.id, toastOnNew])

  return state
}
