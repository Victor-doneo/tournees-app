import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Truck, Package, AlertTriangle, CheckCircle, Clock } from 'lucide-react'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [recentTours, setRecentTours] = useState([])
  const [loading, setLoading] = useState(true)
  const [nextDate, setNextDate] = useState('')
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [])

  async function fetchData() {
    try {
      const { data: tours, error } = await supabase
        .from('tour_scan_summary')
        .select('*')
        .or('archived.is.false,archived.is.null')
        .order('delivery_date', { ascending: true })
      if (error) console.error('Dashboard error:', error)

      // Calculer les stats depuis les tournées non archivées
      const allTours = tours || []
      const total_parcels = allTours.reduce((s, t) => s + (t.total_parcels || 0), 0)
      const scanned_parcels = allTours.reduce((s, t) => s + (t.scanned_count || 0), 0)
      const anomalies_wrong_tour = allTours.reduce((s, t) => s + (t.wrong_tour_count || 0), 0)
      const anomalies_unknown = allTours.reduce((s, t) => s + (t.unknown_count || 0), 0)
      const completed_tours = allTours.filter(t => t.status === 'completed').length
      const in_progress_tours = allTours.filter(t => t.status === 'in_progress').length
      const pending_tours = allTours.filter(t => t.status === 'pending').length

      const dashboard = {
        total_tours: allTours.length,
        completed_tours,
        in_progress_tours,
        pending_tours,
        total_parcels,
        scanned_parcels,
        anomalies_wrong_tour,
        anomalies_unknown,
      }

      // Prochaine date disponible
      const nextD = allTours[0]?.delivery_date
      if (nextD) setNextDate(nextD)

      const tomorrowDate = nextD

      // tours already fetched above

      setStats(dashboard)
      setRecentTours(allTours)
    } catch (e) {
      console.error('Dashboard error:', e)
    } finally {
      setLoading(false)
    }
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
            <p className="page-subtitle" style={{ textTransform: 'capitalize' }}>Préparation du {nextDate ? new Date(nextDate + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '...'}</p>
          </div>
        </div>
      </div>

      <div className="page-body">
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
