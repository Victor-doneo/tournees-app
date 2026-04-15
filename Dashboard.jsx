import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Truck, Package, AlertTriangle, CheckCircle, Clock } from 'lucide-react'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [recentTours, setRecentTours] = useState([])
  const [loading, setLoading] = useState(true)
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

  useEffect(() => {
    fetchData()
    // Refresh toutes les 30 secondes
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [])

  async function fetchData() {
    const todayDate = new Date().toISOString().split('T')[0]

    const { data: dashboard } = await supabase
      .from('daily_dashboard')
      .select('*')
      .eq('delivery_date', todayDate)
      .single()

    const { data: tours } = await supabase
      .from('tour_scan_summary')
      .select('*')
      .eq('archived', false)
      .order('delivery_date', { ascending: false })
      .limit(10)

    setStats(dashboard || {
      total_tours: 0, completed_tours: 0, in_progress_tours: 0, pending_tours: 0,
      total_parcels: 0, scanned_parcels: 0, anomalies_wrong_tour: 0, anomalies_unknown: 0
    })
    setRecentTours(tours || [])
    setLoading(false)
  }

  function statusBadge(status) {
    const map = {
      completed: { label: 'Terminé', cls: 'badge-green' },
      in_progress: { label: 'En cours', cls: 'badge-blue' },
      pending: { label: 'En attente', cls: 'badge-gray' },
    }
    const s = map[status] || map.pending
    return <span className={`badge ${s.cls}`}>{s.label}</span>
  }

  if (loading) return (
    <div className="loading-center" style={{ height: '100%' }}>
      <div className="spinner dark" />
      <span>Chargement...</span>
    </div>
  )

  const pct = stats.total_parcels > 0
    ? Math.round((stats.scanned_parcels / stats.total_parcels) * 100)
    : 0

  return (
    <>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="page-title">Dashboard</h2>
            <p className="page-subtitle" style={{ textTransform: 'capitalize' }}>{today}</p>
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="stat-label">Tournées du jour</span>
              <Truck size={18} color="var(--accent)" />
            </div>
            <div className="stat-value">{stats.total_tours}</div>
            <div className="stat-sub">{stats.completed_tours} terminées · {stats.in_progress_tours} en cours</div>
          </div>

          <div className="stat-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="stat-label">Colis contrôlés</span>
              <Package size={18} color="var(--green)" />
            </div>
            <div className="stat-value">{stats.scanned_parcels || 0}</div>
            <div className="stat-sub">sur {stats.total_parcels || 0} attendus</div>
          </div>

          <div className="stat-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="stat-label">Avancement</span>
              <CheckCircle size={18} color="var(--green)" />
            </div>
            <div className="stat-value">{pct}%</div>
            <div style={{ marginTop: '8px' }}>
              <div className="progress-bar">
                <div className={`progress-fill ${pct === 100 ? 'green' : pct > 50 ? '' : 'orange'}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>

          <div className="stat-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="stat-label">Anomalies</span>
              <AlertTriangle size={18} color="var(--orange)" />
            </div>
            <div className="stat-value" style={{ color: (stats.anomalies_wrong_tour + stats.anomalies_unknown) > 0 ? 'var(--red)' : 'var(--gray-800)' }}>
              {(stats.anomalies_wrong_tour || 0) + (stats.anomalies_unknown || 0)}
            </div>
            <div className="stat-sub">{stats.anomalies_wrong_tour || 0} mauvaise tournée · {stats.anomalies_unknown || 0} inconnus</div>
          </div>
        </div>

        {/* Tournées récentes */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Tournées actives</span>
            <span className="badge badge-purple">{recentTours.filter(t => !t.archived).length} tournées</span>
          </div>
          <div className="table-wrapper">
            {recentTours.length === 0 ? (
              <div className="empty-state">
                <Truck size={40} className="empty-state-icon" />
                <p className="empty-state-title">Aucune tournée active</p>
                <p className="empty-state-sub">Importez un PDF pour créer des tournées.</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Tournée</th>
                    <th>Date livraison</th>
                    <th>Statut</th>
                    <th>Colis scannés</th>
                    <th>Manquants</th>
                    <th>Anomalies</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTours.map(t => (
                    <tr key={t.tour_id}>
                      <td><strong style={{ fontFamily: 'var(--font-display)' }}>{t.tour_name}</strong></td>
                      <td>{new Date(t.delivery_date).toLocaleDateString('fr-FR')}</td>
                      <td>{statusBadge(t.status)}</td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{t.scanned_count}</span>
                        <span style={{ color: 'var(--gray-400)' }}> / {t.total_parcels}</span>
                      </td>
                      <td>
                        {t.missing_count > 0
                          ? <span style={{ color: 'var(--red)', fontWeight: 600 }}>{t.missing_count}</span>
                          : <span style={{ color: 'var(--green)' }}>0</span>
                        }
                      </td>
                      <td>
                        {(t.wrong_tour_count + t.unknown_count) > 0
                          ? <span className="badge badge-orange">{t.wrong_tour_count + t.unknown_count}</span>
                          : <span style={{ color: 'var(--gray-300)' }}>—</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
