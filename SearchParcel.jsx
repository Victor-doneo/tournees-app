import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from './supabase'
import { Search, Package, AlertTriangle, CheckCircle, XCircle, Clock, ClipboardList, Printer, PackageX, Truck } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from './AuthContext'
import { printLabels } from './retourLabels'
import { syncTourReturns } from './retourSync'

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
  const { user, profile } = useAuth()
  const canAct = profile?.role !== 'partner' // les partenaires restent en lecture seule
  const [retours, setRetours] = useState([]) // étiquettes « colis à retourner » trouvées

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
    await loadRetours(q)

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

  const hhmm = iso => iso ? new Date(iso).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }) : ''

  // Étiquettes de colis à retourner correspondant au numéro (avec ou sans le « 7 » de tête) + la tournée concernée
  async function loadRetours(q) {
    const clean = q.replace(/[%,()]/g, '')
    const { data: labs } = await supabase.from('return_labels').select('*').or(`barcode.ilike.%${clean}%`).order('task_date', { ascending: false }).limit(20)
    const out = []
    for (const l of labs || []) {
      let tour = null
      if (l.tour_code) {
        const { data: dd } = await supabase.from('delivery_dates').select('id').eq('delivery_date', l.task_date).maybeSingle()
        if (dd) {
          const { data: ts } = await supabase.from('tours').select('id, name, heure_retour, status, tours_references(name)').eq('delivery_date_id', dd.id)
          tour = (ts || []).find(t => (t.tours_references?.name || t.name) === l.tour_code) || null
        }
      }
      out.push({ ...l, tour })
    }
    setRetours(out)
  }

  async function receiveLabel(l) {
    const { error } = await supabase.from('return_labels').update({ received_at: new Date().toISOString(), received_by: user?.id || null }).eq('id', l.id)
    if (error) return toast.error(error.message)
    toast.success('Réception du colis enregistrée')
    if (l.tour_code) { const back = await syncTourReturns(l.task_date, [l.tour_code]); if (back.length) toast.success('Tournée revenue ✔') }
    loadRetours(query.trim())
  }

  async function confirmTourReturn(l) {
    if (!l.tour || !confirm(`Confirmer le retour de la TOURNÉE "${l.tour_code}" ? (indépendant de la réception de ce colis)`)) return
    const { error } = await supabase.from('tours').update({ heure_retour: new Date().toISOString(), status: 'completed' }).eq('id', l.tour.id)
    if (error) return toast.error(error.message)
    toast.success('Retour de la tournée confirmé')
    loadRetours(query.trim())
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

        {!loading && searched && retours.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
            {retours.map(l => (
              <div key={l.id} className="card" style={{ overflow: 'hidden', borderLeft: '4px solid var(--orange)' }}>
                <div style={{ padding: '12px 16px', background: 'var(--gray-50)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <PackageX size={16} />
                  <b>Colis à retourner</b>
                  <code style={{ fontFamily: 'monospace', fontWeight: 700, background: 'var(--gray-200)', padding: '3px 10px', borderRadius: 6 }}>{l.barcode}</code>
                  <span style={{ fontSize: 13 }}>{l.customer_name} · {l.reason} · tournée {l.tour_code || '—'} · {new Date(l.task_date + 'T12:00:00').toLocaleDateString('fr-FR')}</span>
                  {l.reflex_reception && <span className="badge badge-gray">REFLEX {l.reflex_reception}</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                  <div style={{ padding: '12px 16px', borderRight: '1px solid var(--gray-100)' }}>
                    <div style={{ fontSize: 11, color: 'var(--gray-400)', textTransform: 'uppercase', marginBottom: 6 }}>Ce colis</div>
                    {l.received_at ? <span className="badge badge-green">Réceptionné à {hhmm(l.received_at)}</span> : <span className="badge badge-gray">Non réceptionné</span>}
                    {canAct && <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => printLabels([l])}><Printer size={14} /> Imprimer l'étiquette</button>
                      {!l.received_at && <button className="btn btn-primary btn-sm" onClick={() => receiveLabel(l)}><CheckCircle size={14} /> Accuser réception du colis</button>}
                    </div>}
                  </div>
                  <div style={{ padding: '12px 16px', background: '#f7f9ff' }}>
                    <div style={{ fontSize: 11, color: 'var(--gray-400)', textTransform: 'uppercase', marginBottom: 6 }}>La tournée {l.tour_code || ''}</div>
                    {!l.tour ? <span style={{ fontSize: 13, color: 'var(--gray-400)' }}>Tournée introuvable</span>
                      : l.tour.heure_retour ? <span className="badge badge-green"><Truck size={11} /> Tournée rentrée à {hhmm(l.tour.heure_retour)}</span>
                      : <span className="badge badge-orange"><Truck size={11} /> Tournée non rentrée</span>}
                    {canAct && l.tour && !l.tour.heure_retour && <div style={{ marginTop: 10 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => confirmTourReturn(l)}><Truck size={14} /> Confirmer le retour de la tournée</button>
                    </div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && searched && (
          results.length === 0 ? (
            retours.length > 0 ? null : <div className="card">
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
