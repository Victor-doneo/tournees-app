import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { RotateCcw } from 'lucide-react'

export default function Reprises() {
  const [reprises, setReprises] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterDate, setFilterDate] = useState(() => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    return tomorrow.toISOString().split('T')[0]
  })

  useEffect(() => { fetchReprises() }, [filterDate])

  async function fetchReprises() {
    setLoading(true)
    let query = supabase
      .from('parcels')
      .select('barcode, exclusion_reason, tours(name, delivery_dates(delivery_date))')
      .eq('excluded', true)
      .eq('exclusion_reason', 'Reprise')
      .order('barcode')

    const { data } = await query

    // Filtrer par date côté client
    const filtered = (data || []).filter(p => {
      const d = p.tours?.delivery_dates?.delivery_date
      return !filterDate || d === filterDate
    })

    setReprises(filtered)
    setLoading(false)
  }

  // Grouper par tournée
  const byTour = reprises.reduce((acc, p) => {
    const name = p.tours?.name || 'Inconnue'
    if (!acc[name]) acc[name] = []
    acc[name].push(p)
    return acc
  }, {})

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">Reprises</h2>
        <p className="page-subtitle">Colis exclus du contrôle — à traiter via Reflex</p>
      </div>

      <div className="page-body">

        {/* Filtre date */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Date de livraison</label>
            <input
              type="date"
              className="form-input"
              value={filterDate}
              onChange={e => setFilterDate(e.target.value)}
              style={{ width: 'auto' }}
            />
          </div>
          {reprises.length > 0 && (
            <div style={{ paddingTop: '20px' }}>
              <span className="badge badge-orange">{reprises.length} reprise{reprises.length > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="loading-center"><div className="spinner dark" /></div>
        ) : reprises.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <RotateCcw size={36} className="empty-state-icon" />
              <p className="empty-state-title">Aucune reprise</p>
              <p className="empty-state-sub">Aucune reprise pour cette date.</p>
            </div>
          </div>
        ) : (
          Object.entries(byTour).sort(([a], [b]) => a.localeCompare(b)).map(([tourName, parcels]) => (
            <div key={tourName} style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '14px', color: 'var(--gray-700)' }}>
                  {tourName}
                </span>
                <span className="badge badge-gray">{parcels.length} reprise{parcels.length > 1 ? 's' : ''}</span>
              </div>

              <div className="card" style={{ overflow: 'hidden' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Barcode</th>
                      <th>Tournée</th>
                      <th>Raison</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parcels.map(p => (
                      <tr key={p.barcode}>
                        <td>
                          <code style={{ fontFamily: 'monospace', fontSize: '13px', background: 'var(--gray-100)', padding: '2px 8px', borderRadius: '4px' }}>
                            {p.barcode}
                          </code>
                        </td>
                        <td style={{ fontSize: '13px', color: 'var(--gray-600)' }}>{p.tours?.name}</td>
                        <td><span className="badge badge-orange">Reprise</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}
