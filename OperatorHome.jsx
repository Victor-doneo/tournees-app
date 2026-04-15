import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabase'
import { Truck, Package, ChevronRight } from 'lucide-react'

export default function OperatorHome() {
  const [tours, setTours] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  const todayDate = new Date().toISOString().split('T')[0]

  useEffect(() => { fetchTours() }, [])

  async function fetchTours() {
    // On affiche les tournées d'aujourd'hui ET de demain (contrôle J-1)
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowDate = tomorrow.toISOString().split('T')[0]

    const { data } = await supabase
      .from('tour_scan_summary')
      .select('*')
      .eq('archived', false)
      .in('delivery_date', [todayDate, tomorrowDate])
      .order('tour_name')

    setTours(data || [])
    setLoading(false)
  }

  function statusColor(status) {
    if (status === 'completed') return 'var(--green)'
    if (status === 'in_progress') return 'var(--accent)'
    return 'var(--gray-300)'
  }

  function statusLabel(status) {
    if (status === 'completed') return 'Terminée ✓'
    if (status === 'in_progress') return 'En cours...'
    return 'À contrôler'
  }

  if (loading) return (
    <div className="loading-center" style={{ height: '100%' }}>
      <div className="spinner dark" />
    </div>
  )

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">Sélectionnez votre tournée</h2>
        <p className="page-subtitle" style={{ textTransform: 'capitalize' }}>{today}</p>
      </div>

      <div className="page-body">
        {tours.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <Truck size={48} className="empty-state-icon" />
              <p className="empty-state-title">Aucune tournée disponible</p>
              <p className="empty-state-sub">Les tournées apparaîtront ici une fois le PDF importé par l'administrateur.</p>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
            {tours.map(t => {
              const pct = t.total_parcels > 0 ? Math.round((t.scanned_count / t.total_parcels) * 100) : 0
              const hasAnomalies = (t.wrong_tour_count + t.unknown_count) > 0

              return (
                <div
                  key={t.tour_id}
                  className="tour-card"
                  onClick={() => navigate(`/operator/scan/${t.tour_id}`)}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div>
                      <div className="tour-card-name">{t.tour_name}</div>
                      <div className="tour-card-meta">
                        {new Date(t.delivery_date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                      </div>
                    </div>
                    <ChevronRight size={18} color="var(--gray-300)" />
                  </div>

                  {/* Progress */}
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                      <span style={{ color: 'var(--gray-500)' }}>
                        <Package size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                        {t.scanned_count} / {t.total_parcels} colis
                      </span>
                      <span style={{ fontWeight: 600, color: statusColor(t.status) }}>{pct}%</span>
                    </div>
                    <div className="progress-bar">
                      <div
                        className={`progress-fill ${t.status === 'completed' ? 'green' : ''}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', color: statusColor(t.status), fontWeight: 500 }}>
                      {statusLabel(t.status)}
                    </span>
                    {t.missing_count > 0 && (
                      <span className="badge badge-red" style={{ fontSize: '11px', padding: '2px 8px' }}>
                        {t.missing_count} manquants
                      </span>
                    )}
                    {hasAnomalies && (
                      <span className="badge badge-orange" style={{ fontSize: '11px', padding: '2px 8px' }}>
                        {t.wrong_tour_count + t.unknown_count} anomalies
                      </span>
                    )}
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
