import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { RotateCcw, ArrowLeftRight } from 'lucide-react'

export default function Reprises() {
  const [reprises, setReprises] = useState([])
  const [lcr, setLcr] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterDate, setFilterDate] = useState(() => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    return tomorrow.toISOString().split('T')[0]
  })

  useEffect(() => { fetchReprises() }, [filterDate])

  async function fetchReprises() {
    setLoading(true)

    // Filtre par date côté base (sinon Supabase tronque à 1000 lignes toutes dates confondues et des colis disparaissent)
    let q = supabase
      .from('parcels')
      .select(`barcode, excluded, exclusion_reason, dea, tours${filterDate ? '!inner' : ''}(name, delivery_dates${filterDate ? '!inner' : ''}(delivery_date))`)
      .or('exclusion_reason.eq.Reprise,exclusion_reason.eq.Livraison contre reprise')
      .eq('dea', false)
    if (filterDate) q = q.eq('tours.delivery_dates.delivery_date', filterDate)
    const { data } = await q.order('barcode').limit(5000)

    const filtered = (data || []).filter(p => {
      const d = p.tours?.delivery_dates?.delivery_date
      return !filterDate || d === filterDate
    })

    setReprises(filtered.filter(p => p.exclusion_reason === 'Reprise'))
    setLcr(filtered.filter(p => p.exclusion_reason === 'Livraison contre reprise'))
    setLoading(false)
  }

  function groupByTour(items) {
    return items.reduce((acc, p) => {
      const name = p.tours?.name || 'Inconnue'
      if (!acc[name]) acc[name] = []
      acc[name].push(p)
      return acc
    }, {})
  }

  function renderTable(items) {
    const byTour = groupByTour(items)
    if (Object.keys(byTour).length === 0) return (
      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>
        Aucun colis pour cette date
      </div>
    )
    return Object.entries(byTour).sort(([a], [b]) => a.localeCompare(b)).map(([tourName, parcels]) => (
      <div key={tourName} style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '14px', color: 'var(--gray-700)' }}>
            {tourName}
          </span>
          <span className="badge badge-gray">{parcels.length}</span>
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Barcode</th>
                <th>Tournée</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ))
  }

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">Reprises</h2>
        <p className="page-subtitle">Colis à traiter via Reflex</p>
      </div>

      <div className="page-body">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
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
          {!loading && (
            <div style={{ paddingTop: '20px', display: 'flex', gap: 8 }}>
              {reprises.length > 0 && (
                <span className="badge badge-orange">{reprises.length} reprise{reprises.length > 1 ? 's' : ''}</span>
              )}
              {lcr.length > 0 && (
                <span className="badge badge-blue">{lcr.length} livraison{lcr.length > 1 ? 's' : ''} contre reprise</span>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="loading-center"><div className="spinner dark" /></div>
        ) : (
          <>
            <div style={{ marginBottom: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <div style={{ width: 32, height: 32, borderRadius: '8px', background: 'var(--orange-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <RotateCcw size={16} color="var(--orange)" />
                </div>
                <div>
                  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 700, color: 'var(--gray-800)' }}>
                    Reprises
                  </h3>
                  <p style={{ fontSize: '12px', color: 'var(--gray-400)' }}>
                    Colis à récupérer chez le client — générer le bon via Reflex
                  </p>
                </div>
                <span className="badge badge-orange" style={{ marginLeft: 'auto' }}>{reprises.length}</span>
              </div>
              {reprises.length === 0 ? (
                <div className="card">
                  <div className="empty-state" style={{ padding: '32px' }}>
                    <RotateCcw size={28} className="empty-state-icon" />
                    <p className="empty-state-title">Aucune reprise</p>
                  </div>
                </div>
              ) : renderTable(reprises)}
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <div style={{ width: 32, height: 32, borderRadius: '8px', background: 'var(--blue-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ArrowLeftRight size={16} color="var(--blue)" />
                </div>
                <div>
                  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 700, color: 'var(--gray-800)' }}>
                    Livraisons contre reprise
                  </h3>
                  <p style={{ fontSize: '12px', color: 'var(--gray-400)' }}>
                    Colis livrés ET repris simultanément — à scanner + bon Reflex
                  </p>
                </div>
                <span className="badge badge-blue" style={{ marginLeft: 'auto' }}>{lcr.length}</span>
              </div>
              {lcr.length === 0 ? (
                <div className="card">
                  <div className="empty-state" style={{ padding: '32px' }}>
                    <ArrowLeftRight size={28} className="empty-state-icon" />
                    <p className="empty-state-title">Aucune livraison contre reprise</p>
                  </div>
                </div>
              ) : renderTable(lcr)}
            </div>
          </>
        )}
      </div>
    </>
  )
}
