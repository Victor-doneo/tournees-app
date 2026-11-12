import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Truck, AlertTriangle, CheckCircle, RefreshCw, Clock, MapPin } from 'lucide-react'
import toast from 'react-hot-toast'
import { syncTourReturns } from './retourSync'

export default function SuiviTournees() {
  const [tours, setTours] = useState([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(null)
  const [labels, setLabels] = useState({})

  useEffect(() => { fetchTours() }, [])

  async function fetchTours() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]

    const { data: dateData } = await supabase
      .from('delivery_dates')
      .select('id')
      .eq('delivery_date', today)
      .maybeSingle()

    if (!dateData) { setTours([]); setLoading(false); return }

    // Colis à retourner par tournée : si tous sont réceptionnés, la tournée est considérée comme revenue
    await syncTourReturns(today)
    const { data: lab } = await supabase.from('return_labels').select('tour_code, received_at').eq('task_date', today)
    const g = {}
    for (const l of lab || []) { const k = l.tour_code; if (!k) continue; g[k] = g[k] || { total: 0, received: 0 }; g[k].total++; if (l.received_at) g[k].received++ }
    setLabels(g)

    const { data } = await supabase
      .from('tours')
      .select('id, name, status, retard, heure_retour, reference_id, type_livraison, heure_premiere_livraison, code_postal_premiere_livraison, tours_references(name)')
      .eq('delivery_date_id', dateData.id)
      .is('heure_retour', null)
      .order('heure_premiere_livraison', { ascending: true, nullsFirst: false })

    setTours(data || [])
    setLoading(false)
  }

  async function toggleRetard(tour) {
    setUpdating(tour.id)
    const { error } = await supabase
      .from('tours')
      .update({ retard: !tour.retard })
      .eq('id', tour.id)
    if (error) toast.error('Erreur')
    else {
      setTours(prev => prev.map(t => t.id === tour.id ? { ...t, retard: !t.retard } : t))
    }
    setUpdating(null)
  }

  async function confirmerRetour(tour) {
    if (!confirm(`Confirmer le retour de "${tour.tours_references?.name || tour.name}" ?`)) return
    setUpdating(tour.id)
    const { error } = await supabase
      .from('tours')
      .update({ heure_retour: new Date().toISOString(), status: 'completed' })
      .eq('id', tour.id)
    if (error) toast.error('Erreur')
    else {
      toast.success(`Retour confirmé à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`)
      setTours(prev => prev.filter(t => t.id !== tour.id))
    }
    setUpdating(null)
  }

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 className="page-title">Suivi des tournées</h2>
            <p className="page-subtitle" style={{ textTransform: 'capitalize' }}>{today}</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={fetchTours} style={{ paddingTop: 4 }}>
            <RefreshCw size={14} /> Actualiser
          </button>
        </div>
      </div>

      <div className="page-body">
        {loading ? (
          <div className="loading-center"><div className="spinner dark" /></div>
        ) : tours.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <CheckCircle size={40} className="empty-state-icon" style={{ color: 'var(--green)' }} />
              <p className="empty-state-title">Toutes les tournées sont rentrées !</p>
              <p className="empty-state-sub">Aucune tournée en attente de retour aujourd'hui.</p>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Résumé */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 8 }}>
              <div style={{ background: 'var(--white)', borderRadius: 'var(--radius)', border: '1px solid var(--gray-200)', borderTop: '3px solid var(--accent)', padding: '14px 16px', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, color: 'var(--accent)' }}>{tours.length}</div>
                <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>En attente</div>
              </div>
              <div style={{ background: 'var(--white)', borderRadius: 'var(--radius)', border: '1px solid var(--gray-200)', borderTop: '3px solid var(--red)', padding: '14px 16px', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, color: 'var(--red)' }}>{tours.filter(t => t.retard).length}</div>
                <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>En retard</div>
              </div>
            </div>

            {/* Liste tournées */}
            {tours.map(t => {
              const refName = t.tours_references?.name || t.name
              const isUpdating = updating === t.id
              return (
                <div key={t.id} className="card" style={{ overflow: 'hidden', borderLeft: t.retard ? '4px solid var(--red)' : '4px solid transparent' }}>
                  <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    {/* Nom */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16, color: 'var(--gray-800)' }}>
                          {refName}
                        </span>
                        {t.type_livraison && (
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 100, background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}>
                            {t.type_livraison}
                          </span>
                        )}
                        {t.heure_premiere_livraison && (
                          <span style={{ fontSize: 11, color: 'var(--gray-500)', display: 'flex', alignItems: 'center', gap: 3 }}>
                            <Clock size={11} /> {t.heure_premiere_livraison}
                          </span>
                        )}
                        {t.code_postal_premiere_livraison && (
                          <span title="Code postal de la première livraison" style={{ fontSize: 11, color: 'var(--gray-500)', display: 'flex', alignItems: 'center', gap: 3 }}>
                            <MapPin size={11} /> {t.code_postal_premiere_livraison}
                          </span>
                        )}
                      </div>
                      {labels[refName] && (
                        <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: labels[refName].received === labels[refName].total ? 'var(--green)' : 'var(--orange)' }}>
                          Colis à retourner : {labels[refName].received}/{labels[refName].total} réceptionnés
                        </div>
                      )}
                      {t.retard && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                          <AlertTriangle size={12} color="var(--red)" />
                          <span style={{ fontSize: 12, color: 'var(--red)', fontWeight: 600 }}>Retard signalé</span>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      {/* Bouton retard */}
                      <button
                        className="btn btn-sm"
                        disabled={isUpdating}
                        onClick={() => toggleRetard(t)}
                        style={{
                          background: t.retard ? '#fef2f2' : 'var(--white)',
                          border: t.retard ? '1px solid #fca5a5' : '1px solid var(--gray-200)',
                          color: t.retard ? 'var(--red)' : 'var(--gray-500)',
                        }}
                      >
                        <AlertTriangle size={13} />
                        <span style={{ marginLeft: 4, fontSize: 12 }}>
                          {t.retard ? 'Retard signalé' : 'Signaler retard'}
                        </span>
                      </button>

                      {/* Bouton retour */}
                      <button
                        className="btn btn-sm"
                        disabled={isUpdating}
                        onClick={() => confirmerRetour(t)}
                        style={{ background: '#f0fdf4', border: '1px solid #a7f3d0', color: '#059669' }}
                      >
                        {isUpdating
                          ? <div className="spinner" style={{ width: 13, height: 13 }} />
                          : <><Clock size={13} /><span style={{ marginLeft: 4, fontSize: 12 }}>Confirmer retour</span></>
                        }
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
