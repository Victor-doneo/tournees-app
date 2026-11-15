import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from './supabase'
import { Search, Package, AlertTriangle, CheckCircle, XCircle, Clock, ClipboardList } from 'lucide-react'

const DEMANDE_TYPE_LABELS = {
  securisation: { label: 'Sécurisation', badge: 'badge-red' },
  ajout_non_planifie: { label: 'Ajout non planifié', badge: 'badge-orange' },
  recherche_colis: { label: 'Recherche de colis', badge: 'badge-blue' },
  autre: { label: 'Autre demande', badge: 'badge-gray' },
}

export default function SearchParcel() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const basePath = location.pathname.startsWith('/admin') ? '/admin' : location.pathname.startsWith('/partner') ? '/partner' : '/operator'

  const [query, setQuery] = useState(searchParams.get('barcode') || '')
  const [results, setResults] = useState([])
  const [demandesByBarcode, setDemandesByBarcode] = useState({})
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  // Recherche automatique si on arrive depuis une demande (?barcode=...)
  useEffect(() => {
    const fromParam = searchParams.get('barcode')
    if (fromParam) handleSearch(null, fromParam)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSearch(e, forcedQuery) {
    e?.preventDefault()
    const q = (forcedQuery ?? query).trim()
    if (!q) return
    setQuery(q)
    setLoading(true)
    setSearched(true)
    const { data } = await supabase.rpc('search_parcel', { p_barcode: q })
    const parcels = data || []
    setResults(parcels)

    // Récupérer les demandes rattachées aux colis trouvés
    const barcodes = parcels.map(p => p.barcode)
    if (barcodes.length > 0) {
      const { data: demandes } = await supabase
        .from('demandes')
        .select('id, type, status, bp')
        .overlaps('bp', barcodes)
        .order('created_at', { ascending: false })

      const grouped = {}
      for (const d of demandes || []) {
        for (const bp of d.bp || []) {
          if (!barcodes.includes(bp)) continue
          if (!grouped[bp]) grouped[bp] = []
          grouped[bp].push(d)
        }
      }
      setDemandesByBarcode(grouped)
    } else {
      setDemandesByBarcode({})
    }

    setLoading(false)
  }

  function goToDemande(d) {
    navigate(basePath === '/partner' ? `/partner?open=${d.id}` : `${basePath}/demandes?open=${d.id}`)
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
          results.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <Package size={36} className="empty-state-icon" />
                <p className="empty-state-title">Aucun colis trouvé</p>
                <p className="empty-state-sub">Vérifiez le numéro et réessayez.</p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {results.map((r, i) => (
                <div key={i} className="card" style={{ overflow: 'hidden' }}>
                  {/* Header */}
                  <div style={{ padding: '12px 16px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <code style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, background: 'var(--gray-200)', padding: '3px 10px', borderRadius: 6 }}>
                      {r.barcode}
                    </code>
                    {r.excluded && <span className="badge badge-gray">Reprise</span>}
                    {r.was_missing && (
                      <span className="badge badge-red" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <XCircle size={11} /> Manquant à l'archivage
                      </span>
                    )}
                    {r.last_scan_result ? resultBadge(r.last_scan_result) : (
                      <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>Non scanné</span>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 0 }}>
                    {/* Tournée */}
                    <div style={{ padding: '12px 16px', borderRight: '1px solid var(--gray-100)', borderBottom: '1px solid var(--gray-100)' }}>
                      <div style={{ fontSize: 11, color: 'var(--gray-400)', marginBottom: 4 }}>Tournée</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--gray-800)' }}>
                        {r.reference_name || r.tour_name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>
                        {r.delivery_date ? new Date(r.delivery_date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </div>
                    </div>

                    {/* Dernier scan */}
                    <div style={{ padding: '12px 16px', borderRight: '1px solid var(--gray-100)', borderBottom: '1px solid var(--gray-100)' }}>
                      <div style={{ fontSize: 11, color: 'var(--gray-400)', marginBottom: 4 }}>Dernier scan</div>
                      {r.last_scan_at ? (
                        <>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-800)' }}>
                            {new Date(r.last_scan_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>
                            {new Date(r.last_scan_at).toLocaleDateString('fr-FR')}
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: 13, color: 'var(--gray-300)' }}>—</div>
                      )}
                    </div>

                    {/* Scanné par */}
                    <div style={{ padding: '12px 16px', borderRight: '1px solid var(--gray-100)', borderBottom: '1px solid var(--gray-100)' }}>
                      <div style={{ fontSize: 11, color: 'var(--gray-400)', marginBottom: 4 }}>Scanné par</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-800)' }}>
                        {r.last_scan_by || <span style={{ color: 'var(--gray-300)' }}>—</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>
                        {r.scan_count > 0 ? `${r.scan_count} scan${r.scan_count > 1 ? 's' : ''} au total` : 'Aucun scan'}
                      </div>
                    </div>

                    {/* Mauvaise tournée */}
                    {r.last_scan_result === 'wrong_tour' && r.wrong_tour_name && (
                      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray-100)', background: '#fff5f5' }}>
                        <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <AlertTriangle size={11} /> Scanned dans mauvaise tournée
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>
                          {r.wrong_tour_name}
                        </div>
                      </div>
                    )}

                    {/* Tâches liées */}
                    {(demandesByBarcode[r.barcode] || []).length > 0 && (
                      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--gray-100)', gridColumn: '1 / -1' }}>
                        <div style={{ fontSize: 11, color: 'var(--gray-400)', marginBottom: 6 }}>Tâches liées</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {demandesByBarcode[r.barcode].map(d => {
                            const t = DEMANDE_TYPE_LABELS[d.type] || DEMANDE_TYPE_LABELS.autre
                            return (
                              <span
                                key={d.id}
                                className={`badge ${t.badge}`}
                                style={{ cursor: 'pointer' }}
                                onClick={() => goToDemande(d)}
                                title="Voir la demande"
                              >
                                <ClipboardList size={11} /> {t.label}
                                {d.status === 'resolue' && ' ✓'}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </>
  )
}
