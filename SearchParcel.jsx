import { useState } from 'react'
import { supabase } from './supabase'
import { Search, Package } from 'lucide-react'

export default function SearchParcel() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  async function handleSearch(e) {
    e?.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setSearched(true)

    const { data, error } = await supabase.rpc('search_parcel', { p_barcode: query.trim() })
    setResults(data || [])
    setLoading(false)
  }

  function resultBadge(type) {
    const map = {
      ok: { label: 'Conforme', cls: 'badge-green' },
      already_scanned: { label: 'Déjà scanné', cls: 'badge-blue' },
      unknown: { label: 'Inconnu', cls: 'badge-orange' },
      wrong_tour: { label: 'Mauvaise tournée', cls: 'badge-red' },
    }
    const s = map[type]
    if (!s) return null
    return <span className={`badge ${s.cls}`}>{s.label}</span>
  }

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">Recherche de colis</h2>
        <p className="page-subtitle">Retrouvez un colis par son numéro de barcode</p>
      </div>

      <div className="page-body">
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '10px', maxWidth: '500px', marginBottom: '24px' }}>
          <input
            className="form-input"
            placeholder="Numéro de colis (partiel ou complet)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          <button className="btn btn-primary" type="submit" disabled={loading}>
            <Search size={15} />
            {loading ? 'Recherche...' : 'Chercher'}
          </button>
        </form>

        {loading && <div className="loading-center"><div className="spinner dark" /></div>}

        {!loading && searched && (
          <div className="card">
            {results.length === 0 ? (
              <div className="empty-state">
                <Package size={36} className="empty-state-icon" />
                <p className="empty-state-title">Aucun colis trouvé</p>
                <p className="empty-state-sub">Vérifiez le numéro et réessayez.</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Barcode</th>
                      <th>Tournée</th>
                      <th>Date livraison</th>
                      <th>Statut</th>
                      <th>Dernier scan</th>
                      <th>Scanné par</th>
                      <th>Nbre scans</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={i}>
                        <td>
                          <code style={{ fontFamily: 'monospace', fontSize: '13px', background: 'var(--gray-100)', padding: '2px 8px', borderRadius: '4px' }}>
                            {r.barcode}
                          </code>
                          {r.excluded && <span className="badge badge-gray" style={{ marginLeft: '6px' }}>Reprise</span>}
                        </td>
                        <td><strong style={{ fontFamily: 'var(--font-display)' }}>{r.tour_name}</strong></td>
                        <td>{r.delivery_date ? new Date(r.delivery_date + 'T12:00:00').toLocaleDateString('fr-FR') : '—'}</td>
                        <td>{r.last_scan_result ? resultBadge(r.last_scan_result) : <span style={{ color: 'var(--gray-300)' }}>Non scanné</span>}</td>
                        <td style={{ fontSize: '13px', color: 'var(--gray-500)' }}>
                          {r.last_scan_at ? new Date(r.last_scan_at).toLocaleString('fr-FR') : '—'}
                        </td>
                        <td style={{ fontSize: '13px' }}>{r.last_scan_by || '—'}</td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ fontWeight: 600 }}>{r.scan_count}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
