import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabase'
import { Truck, Archive, RotateCcw, ScanLine, ChevronDown, ChevronUp, AlertTriangle, Package } from 'lucide-react'
import toast from 'react-hot-toast'

export default function Tours() {
  const navigate = useNavigate()
  const [tours, setTours] = useState([])
  const [loading, setLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [detail, setDetail] = useState({}) // { tourId: { parcels, scanned, missing, anomalies } }
  const [detailLoading, setDetailLoading] = useState(false)

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

  async function toggleDetail(tour) {
    if (expanded === tour.tour_id) { setExpanded(null); return }
    setExpanded(tour.tour_id)
    if (detail[tour.tour_id]) return

    setDetailLoading(true)
    try {
      // Tous les colis de la tournée
      const { data: parcels } = await supabase
        .from('parcels')
        .select('barcode, excluded, exclusion_reason')
        .eq('tour_id', tour.tour_id)
        .order('barcode')

      // Tous les scans de la tournée
      const { data: scans } = await supabase
        .from('scan_events')
        .select('barcode_scanned, result_type, scanned_at, users(full_name)')
        .eq('tour_id', tour.tour_id)
        .order('scanned_at', { ascending: false })

      const activeParcels = (parcels || []).filter(p => !p.excluded)
      const scannedBarcodes = new Set(
        (scans || []).filter(s => s.result_type === 'ok' || s.result_type === 'already_scanned')
          .map(s => s.barcode_scanned)
      )
      const missingParcels = activeParcels.filter(p => !scannedBarcodes.has(p.barcode))
      const anomalies = (scans || []).filter(s => s.result_type === 'wrong_tour')
      const excluded = (parcels || []).filter(p => p.excluded)

      setDetail(d => ({
        ...d,
        [tour.tour_id]: {
          activeParcels,
          scannedBarcodes,
          missingParcels,
          anomalies,
          excluded,
          scans: scans || [],
        }
      }))
    } finally {
      setDetailLoading(false)
    }
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {dateTours.map(t => (
                  <div key={t.tour_id} className="card" style={{ opacity: t.archived ? 0.6 : 1, overflow: 'hidden' }}>

                    {/* Ligne principale */}
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px', cursor: 'pointer' }}
                      onClick={() => toggleDetail(t)}
                    >
                      {/* Nom + statut */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                          <strong style={{ fontFamily: 'var(--font-display)', fontSize: '15px' }}>{t.tour_name}</strong>
                          {t.archived && <span className="badge badge-gray">Archivée</span>}
                          {statusBadge(t.status)}
                        </div>
                      </div>

                      {/* Stats */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexShrink: 0 }}>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '18px' }}>
                            {t.scanned_count}<span style={{ color: 'var(--gray-300)', fontWeight: 400, fontSize: '13px' }}>/{t.total_parcels}</span>
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--gray-400)', textTransform: 'uppercase' }}>Scannés</div>
                        </div>

                        {t.missing_count > 0 && (
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '18px', color: 'var(--red)' }}>
                              {t.missing_count}
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--gray-400)', textTransform: 'uppercase' }}>Manquants</div>
                          </div>
                        )}

                        {(t.wrong_tour_count + t.unknown_count) > 0 && (
                          <span className="badge badge-orange">{t.wrong_tour_count + t.unknown_count} anomalies</span>
                        )}

                        {t.excluded_parcels > 0 && (
                          <span className="badge badge-gray">{t.excluded_parcels} reprise{t.excluded_parcels > 1 ? 's' : ''}</span>
                        )}
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => navigate(`/operator/scan/${t.tour_id}`)}
                          title="Scanner cette tournée"
                        >
                          <ScanLine size={14} /> Scanner
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => toggleArchive(t)}
                          title={t.archived ? 'Désarchiver' : 'Archiver'}
                        >
                          {t.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
                        </button>
                      </div>

                      {expanded === t.tour_id
                        ? <ChevronUp size={16} color="var(--gray-400)" />
                        : <ChevronDown size={16} color="var(--gray-400)" />
                      }
                    </div>

                    {/* Panneau de détail */}
                    {expanded === t.tour_id && (
                      <div style={{ borderTop: '1px solid var(--gray-100)' }}>
                        {detailLoading && !detail[t.tour_id] ? (
                          <div className="loading-center" style={{ padding: '24px' }}>
                            <div className="spinner dark" />
                          </div>
                        ) : detail[t.tour_id] ? (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>

                            {/* Colonne 1 : Tous les colis */}
                            <div style={{ borderRight: '1px solid var(--gray-100)' }}>
                              <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <Package size={13} color="var(--gray-400)" />
                                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>Tous les colis</span>
                                </div>
                                <span style={{ fontSize: '11px', color: 'var(--gray-400)' }}>{detail[t.tour_id].activeParcels.length}</span>
                              </div>
                              <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
                                {detail[t.tour_id].activeParcels.map(p => {
                                  const isScanned = detail[t.tour_id].scannedBarcodes.has(p.barcode)
                                  return (
                                    <div key={p.barcode} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 16px', borderBottom: '1px solid var(--gray-100)', background: isScanned ? '#f0fdf4' : undefined }}>
                                      <span style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, background: isScanned ? '#05996920' : 'var(--red-light)', color: isScanned ? '#059669' : 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }}>
                                        {isScanned ? '✓' : '✗'}
                                      </span>
                                      <code style={{ fontSize: '11px', color: 'var(--gray-600)' }}>{p.barcode}</code>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>

                            {/* Colonne 2 : Manquants */}
                            <div style={{ borderRight: '1px solid var(--gray-100)' }}>
                              <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--gray-100)', background: detail[t.tour_id].missingParcels.length > 0 ? 'var(--red-light)' : 'var(--green-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '12px', fontWeight: 600, color: detail[t.tour_id].missingParcels.length > 0 ? '#991b1b' : '#065f46' }}>
                                  Manquants
                                </span>
                                <span style={{ fontSize: '11px', fontWeight: 600, color: detail[t.tour_id].missingParcels.length > 0 ? '#991b1b' : '#065f46' }}>
                                  {detail[t.tour_id].missingParcels.length}
                                </span>
                              </div>
                              <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
                                {detail[t.tour_id].missingParcels.length === 0 ? (
                                  <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--green)', fontSize: '12px' }}>Tous scannés ✓</div>
                                ) : detail[t.tour_id].missingParcels.map(p => (
                                  <div key={p.barcode} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 16px', borderBottom: '1px solid var(--gray-100)' }}>
                                    <span style={{ color: 'var(--red)', fontSize: 11 }}>✗</span>
                                    <code style={{ fontSize: '11px', color: 'var(--gray-600)' }}>{p.barcode}</code>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Colonne 3 : Anomalies + Reprises */}
                            <div>
                              <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--gray-100)', background: detail[t.tour_id].anomalies.length > 0 ? '#fff7ed' : 'var(--gray-50)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <AlertTriangle size={12} color={detail[t.tour_id].anomalies.length > 0 ? 'var(--orange)' : 'var(--gray-400)'} />
                                  <span style={{ fontSize: '12px', fontWeight: 600, color: detail[t.tour_id].anomalies.length > 0 ? '#92400e' : 'var(--gray-700)' }}>
                                    Anomalies
                                  </span>
                                </div>
                                <span style={{ fontSize: '11px', color: 'var(--gray-400)' }}>{detail[t.tour_id].anomalies.length}</span>
                              </div>
                              <div style={{ maxHeight: '160px', overflowY: 'auto' }}>
                                {detail[t.tour_id].anomalies.length === 0 ? (
                                  <div style={{ padding: '16px', textAlign: 'center', color: 'var(--gray-300)', fontSize: '12px' }}>Aucune anomalie</div>
                                ) : detail[t.tour_id].anomalies.map((s, i) => (
                                  <div key={i} style={{ padding: '6px 16px', borderBottom: '1px solid var(--gray-100)', background: '#fff7ed' }}>
                                    <code style={{ fontSize: '11px', color: '#92400e', fontWeight: 600 }}>{s.barcode_scanned}</code>
                                    <div style={{ fontSize: '10px', color: 'var(--gray-400)', marginTop: '1px' }}>
                                      {new Date(s.scanned_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                      {s.users?.full_name ? ` · ${s.users.full_name}` : ''}
                                    </div>
                                  </div>
                                ))}
                              </div>

                              {/* Reprises */}
                              {detail[t.tour_id].excluded.length > 0 && (
                                <>
                                  <div style={{ padding: '10px 16px', borderTop: '1px solid var(--gray-100)', borderBottom: '1px solid var(--gray-100)', background: 'var(--gray-50)', display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-600)' }}>Reprises</span>
                                    <span style={{ fontSize: '11px', color: 'var(--gray-400)' }}>{detail[t.tour_id].excluded.length}</span>
                                  </div>
                                  <div style={{ maxHeight: '100px', overflowY: 'auto' }}>
                                    {detail[t.tour_id].excluded.map(p => (
                                      <div key={p.barcode} style={{ padding: '6px 16px', borderBottom: '1px solid var(--gray-100)' }}>
                                        <code style={{ fontSize: '11px', color: 'var(--gray-500)' }}>{p.barcode}</code>
                                      </div>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}
