import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { FileSearch, ChevronDown, ChevronUp } from 'lucide-react'

export default function SearchTours() {
  const [tours, setTours] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [scanHistory, setScanHistory] = useState({})
  const [filterDate, setFilterDate] = useState('')
  const [filterName, setFilterName] = useState('')

  useEffect(() => { fetchTours() }, [])

  async function fetchTours() {
    const { data } = await supabase
      .from('tour_scan_summary')
      .select('*')
      .order('delivery_date', { ascending: false })
    setTours(data || [])
    setLoading(false)
  }

  async function loadHistory(tourId) {
    if (expanded === tourId) { setExpanded(null); return }
    setExpanded(tourId)
    if (scanHistory[tourId]) return

    const { data } = await supabase
      .from('scan_events')
      .select('*, users(full_name)')
      .eq('tour_id', tourId)
      .order('scanned_at', { ascending: false })
      .limit(100)

    setScanHistory(h => ({ ...h, [tourId]: data || [] }))
  }

  function resultLabel(type) {
    const map = {
      ok: { label: 'Conforme', cls: 'badge-green' },
      already_scanned: { label: 'Déjà scanné', cls: 'badge-blue' },
      unknown: { label: 'Inconnu', cls: 'badge-orange' },
      wrong_tour: { label: 'Mauvaise tournée', cls: 'badge-red' },
    }
    return map[type] || { label: type, cls: 'badge-gray' }
  }

  const filtered = tours.filter(t => {
    const matchDate = !filterDate || t.delivery_date === filterDate
    const matchName = !filterName || t.tour_name?.toLowerCase().includes(filterName.toLowerCase())
    return matchDate && matchName
  })

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">Recherche de tournées</h2>
        <p className="page-subtitle">Consultez le détail des scans et l'historique par tournée</p>
      </div>

      <div className="page-body">
        {/* Filtres */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <input
            type="date"
            className="form-input"
            style={{ width: 'auto' }}
            value={filterDate}
            onChange={e => setFilterDate(e.target.value)}
          />
          <input
            className="form-input"
            style={{ width: '240px' }}
            placeholder="Nom de tournée..."
            value={filterName}
            onChange={e => setFilterName(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="loading-center"><div className="spinner dark" /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filtered.length === 0 ? (
              <div className="card">
                <div className="empty-state">
                  <FileSearch size={36} className="empty-state-icon" />
                  <p className="empty-state-title">Aucune tournée trouvée</p>
                </div>
              </div>
            ) : filtered.map(t => (
              <div key={t.tour_id} className="card">
                <div
                  style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '16px' }}
                  onClick={() => loadHistory(t.tour_id)}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                      <strong style={{ fontFamily: 'var(--font-display)', fontSize: '16px' }}>{t.tour_name}</strong>
                      {t.archived && <span className="badge badge-gray">Archivée</span>}
                    </div>
                    <span style={{ fontSize: '13px', color: 'var(--gray-400)' }}>
                      {t.delivery_date ? new Date(t.delivery_date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : ''}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                        {t.scanned_count}<span style={{ color: 'var(--gray-300)', fontWeight: 400 }}>/{t.total_parcels}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Colis</div>
                    </div>
                    {(t.wrong_tour_count + t.unknown_count) > 0 && (
                      <span className="badge badge-orange">{t.wrong_tour_count + t.unknown_count} anomalies</span>
                    )}
                    {t.missing_count > 0 && (
                      <span className="badge badge-red">{t.missing_count} manquants</span>
                    )}
                    {expanded === t.tour_id ? <ChevronUp size={16} color="var(--gray-400)" /> : <ChevronDown size={16} color="var(--gray-400)" />}
                  </div>
                </div>

                {/* Historique des scans */}
                {expanded === t.tour_id && (
                  <div style={{ borderTop: '1px solid var(--gray-100)' }}>
                    {!scanHistory[t.tour_id] ? (
                      <div className="loading-center" style={{ padding: '24px' }}><div className="spinner dark" /></div>
                    ) : scanHistory[t.tour_id].length === 0 ? (
                      <div className="empty-state" style={{ padding: '32px' }}>
                        <p className="empty-state-title">Aucun scan pour cette tournée</p>
                      </div>
                    ) : (
                      <table>
                        <thead>
                          <tr>
                            <th>Barcode scanné</th>
                            <th>Résultat</th>
                            <th>Opérateur</th>
                            <th>Heure</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scanHistory[t.tour_id].map(s => {
                            const r = resultLabel(s.result_type)
                            return (
                              <tr key={s.id}>
                                <td>
                                  <code style={{ fontFamily: 'monospace', fontSize: '13px', background: 'var(--gray-100)', padding: '2px 8px', borderRadius: '4px' }}>
                                    {s.barcode_scanned}
                                  </code>
                                </td>
                                <td><span className={`badge ${r.cls}`}>{r.label}</span></td>
                                <td style={{ fontSize: '13px' }}>{s.users?.full_name || '—'}</td>
                                <td style={{ fontSize: '13px', color: 'var(--gray-400)' }}>
                                  {new Date(s.scanned_at).toLocaleString('fr-FR')}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
