import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Truck, Archive, RotateCcw, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'

export default function Tours() {
  const [tours, setTours] = useState([])
  const [loading, setLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => { fetchTours() }, [showArchived])

  async function fetchTours() {
    setLoading(true)
    const query = supabase
      .from('tour_scan_summary')
      .select('*')
      .order('delivery_date', { ascending: false })

    if (!showArchived) query.eq('archived', false)

    const { data } = await query
    setTours(data || [])
    setLoading(false)
  }

  async function toggleArchive(tour) {
    const { error } = await supabase
      .from('tours')
      .update({ archived: !tour.archived })
      .eq('id', tour.tour_id)

    if (error) return toast.error('Erreur lors de l\'archivage')
    toast.success(tour.archived ? 'Tournée désarchivée' : 'Tournée archivée')
    fetchTours()
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

  const filtered = tours.filter(t =>
    t.tour_name?.toLowerCase().includes(filter.toLowerCase())
  )

  // Grouper par date
  const byDate = filtered.reduce((acc, t) => {
    const d = t.delivery_date
    if (!acc[d]) acc[d] = []
    acc[d].push(t)
    return acc
  }, {})

  return (
    <>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="page-title">Tournées</h2>
            <p className="page-subtitle">{tours.length} tournées {showArchived ? 'au total' : 'actives'}</p>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--gray-500)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            Afficher archivées
          </label>
        </div>
      </div>

      <div className="page-body">
        <div style={{ marginBottom: '16px' }}>
          <input
            className="form-input"
            placeholder="Rechercher une tournée..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ maxWidth: '320px' }}
          />
        </div>

        {loading ? (
          <div className="loading-center"><div className="spinner dark" /></div>
        ) : Object.keys(byDate).length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <Truck size={40} className="empty-state-icon" />
              <p className="empty-state-title">Aucune tournée</p>
              <p className="empty-state-sub">Importez un PDF pour créer des tournées.</p>
            </div>
          </div>
        ) : (
          Object.entries(byDate).sort(([a], [b]) => b.localeCompare(a)).map(([date, dateTours]) => (
            <div key={date} style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--gray-700)', fontSize: '15px' }}>
                  {new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                </span>
                <span className="badge badge-gray">{dateTours.length} tournées</span>
              </div>

              <div className="card">
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Tournée</th>
                        <th>Statut</th>
                        <th>Colis scannés</th>
                        <th>Manquants</th>
                        <th>Anomalies</th>
                        <th>Exclus (Reprise)</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {dateTours.map(t => (
                        <tr key={t.tour_id} style={{ opacity: t.archived ? 0.5 : 1 }}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <strong style={{ fontFamily: 'var(--font-display)' }}>{t.tour_name}</strong>
                              {t.archived && <span className="badge badge-gray">Archivée</span>}
                            </div>
                          </td>
                          <td>{statusBadge(t.status)}</td>
                          <td>
                            <span style={{ fontWeight: 600 }}>{t.scanned_count}</span>
                            <span style={{ color: 'var(--gray-400)' }}> / {t.total_parcels}</span>
                          </td>
                          <td>
                            {t.missing_count > 0
                              ? <span style={{ color: 'var(--red)', fontWeight: 600 }}>{t.missing_count}</span>
                              : <span style={{ color: 'var(--green)' }}>0 ✓</span>
                            }
                          </td>
                          <td>
                            {(t.wrong_tour_count + t.unknown_count) > 0
                              ? <span className="badge badge-orange">{t.wrong_tour_count + t.unknown_count}</span>
                              : <span style={{ color: 'var(--gray-300)' }}>—</span>
                            }
                          </td>
                          <td style={{ color: 'var(--gray-400)' }}>{t.excluded_parcels}</td>
                          <td>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => toggleArchive(t)}
                              title={t.archived ? 'Désarchiver' : 'Archiver'}
                            >
                              {t.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
                              {t.archived ? 'Désarchiver' : 'Archiver'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}
