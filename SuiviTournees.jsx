import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { AlertTriangle, CheckCircle, RefreshCw, Clock, MapPin, ChevronDown, ChevronRight, Printer, ScanLine, PackageX } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from './AuthContext'
import { syncTourReturns } from './retourSync'
import { printLabels, todayStr } from './retourLabels'

const hhmm = iso => iso ? new Date(iso).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }) : ''

export default function SuiviTournees() {
  const { user } = useAuth()
  const [day, setDay] = useState(todayStr())
  const [tours, setTours] = useState([])
  const [labels, setLabels] = useState([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(null)
  const [open, setOpen] = useState(new Set())
  const [sel, setSel] = useState(new Set())
  const [scan, setScan] = useState('')
  const [showReturned, setShowReturned] = useState(false)
  const [forcing, setForcing] = useState(false)

  useEffect(() => { fetchAll() }, [day])

  async function fetchAll() {
    setLoading(true)
    const { data: dateData } = await supabase.from('delivery_dates').select('id').eq('delivery_date', day).maybeSingle()
    let tl = []
    if (dateData) {
      await syncTourReturns(day) // tout réceptionné => tournée revenue
      const { data } = await supabase
        .from('tours')
        .select('id, name, status, retard, heure_retour, reference_id, type_livraison, heure_premiere_livraison, code_postal_premiere_livraison, tours_references(name)')
        .eq('delivery_date_id', dateData.id)
        .order('heure_premiere_livraison', { ascending: true, nullsFirst: false })
      tl = data || []
    }
    const { data: lab } = await supabase.from('return_labels').select('*').eq('task_date', day).order('customer_name')
    setTours(tl); setLabels(lab || []); setSel(new Set()); setLoading(false)
  }

  const refOf = t => t.tours_references?.name || t.name
  const labelsByTour = useMemo(() => {
    const g = {}
    labels.forEach(l => { const k = l.tour_code || '—'; (g[k] = g[k] || []).push(l) })
    return g
  }, [labels])
  const knownCodes = new Set(tours.map(refOf))
  const orphanLabels = labels.filter(l => !l.tour_code || !knownCodes.has(l.tour_code))

  async function toggleRetard(tour) {
    setUpdating(tour.id)
    const { error } = await supabase.from('tours').update({ retard: !tour.retard }).eq('id', tour.id)
    if (error) toast.error('Erreur')
    else setTours(prev => prev.map(t => t.id === tour.id ? { ...t, retard: !t.retard } : t))
    setUpdating(null)
  }

  async function confirmerRetour(tour) {
    if (!confirm(`Confirmer le retour de "${refOf(tour)}" ?`)) return
    setUpdating(tour.id)
    const { error } = await supabase.from('tours').update({ heure_retour: new Date().toISOString(), status: 'completed' }).eq('id', tour.id)
    if (error) toast.error('Erreur')
    else { toast.success('Retour confirmé'); fetchAll() }
    setUpdating(null)
  }

  async function receive(list) {
    const ids = list.filter(r => !r.received_at).map(r => r.id)
    if (!ids.length) return toast('Déjà réceptionné')
    const { error } = await supabase.from('return_labels').update({ received_at: new Date().toISOString(), received_by: user?.id || null }).in('id', ids)
    if (error) return toast.error(error.message)
    toast.success(`${ids.length} colis réceptionné(s)`)
    const back = await syncTourReturns(day, [...new Set(list.map(r => r.tour_code).filter(Boolean))])
    if (back.length) toast.success('Tournée revenue ✔')
    fetchAll()
  }
  async function scanReceive(e) {
    e.preventDefault()
    const code = scan.trim(); if (!code) return
    setScan('')
    const r = labels.find(x => x.barcode === code)
    if (!r) return toast.error(`Code ${code} introuvable pour cette date`)
    await receive([r])
  }
  async function print(list) {
    if (!list.length) return toast.error('Aucune étiquette sélectionnée')
    printLabels(list)
    await supabase.from('return_labels').update({ printed_at: new Date().toISOString() }).in('id', list.map(r => r.id))
    fetchAll()
  }
  async function force() {
    setForcing(true)
    const { data, error } = await supabase.functions.invoke('trigger-urbantz-returns', { body: { date: day } })
    setForcing(false)
    if (error || data?.error) return toast.error(data?.error || error.message)
    toast.success('Extraction lancée : actualisation dans ~1 minute')
    setTimeout(fetchAll, 60000)
  }
  const toggleOpen = k => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  function LabelsTable({ list, name }) {
    const allSel = list.every(r => sel.has(r.id))
    return (
      <div className="table-wrapper" style={{ borderTop: '1px solid var(--gray-200)' }}>
        <table>
          <thead><tr>
            <th><input type="checkbox" checked={allSel} onChange={() => setSel(s => { const n = new Set(s); list.forEach(r => allSel ? n.delete(r.id) : n.add(r.id)); return n })} /></th>
            <th>Code-barres</th><th>Article</th><th>Client</th><th>Motif</th><th>Réception</th><th>Imprimé</th></tr></thead>
          <tbody>{list.map(r => (
            <tr key={r.id}>
              <td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
              <td style={{ fontFamily: 'monospace' }}>{r.barcode}</td>
              <td>{r.item_name}<div style={{ color: 'var(--gray-400)', fontSize: 12 }}>{(r.item_description || '').slice(0, 60)}</div></td>
              <td>{r.customer_name}<div style={{ color: 'var(--gray-400)', fontSize: 12 }}>{[r.zip, r.city].filter(Boolean).join(' ')}</div></td>
              <td><span className="badge badge-orange">{r.reason}</span></td>
              <td>{r.received_at ? <span className="badge badge-green">{hhmm(r.received_at)}</span> : <button className="btn btn-secondary btn-sm" onClick={() => receive([r])}>Accuser réception</button>}</td>
              <td>{r.printed_at ? hhmm(r.printed_at) : '—'}</td>
            </tr>))}</tbody>
        </table>
        <div style={{ padding: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => receive(list)}><CheckCircle size={14} /> Tout réceptionner</button>
          <button className="btn btn-secondary btn-sm" onClick={() => print(list.filter(r => sel.has(r.id)))}><Printer size={14} /> Imprimer les cochés</button>
        </div>
      </div>
    )
  }

  const pending = tours.filter(t => !t.heure_retour)
  const visible = showReturned ? tours : pending
  const dayLabel = new Date(day + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  const receivedCount = labels.filter(l => l.received_at).length

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 className="page-title">Suivi des tournées</h2>
            <p className="page-subtitle" style={{ textTransform: 'capitalize' }}>{dayLabel} · colis à retourner récupérés dans Urbantz de 11h30 à 15h30</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="date" className="form-input" value={day} onChange={e => setDay(e.target.value)} />
            <button className="btn btn-ghost btn-sm" onClick={fetchAll}><RefreshCw size={14} /> Actualiser</button>
            <button className="btn btn-secondary btn-sm" disabled={forcing} onClick={force}>{forcing ? 'Lancement…' : 'Forcer l’extraction'}</button>
            <button className="btn btn-primary btn-sm" onClick={() => print(labels.filter(r => sel.has(r.id)))}><Printer size={14} /> Imprimer la sélection ({sel.size})</button>
            <button className="btn btn-secondary btn-sm" onClick={() => receive(labels.filter(r => sel.has(r.id)))}><CheckCircle size={14} /> Accuser réception ({sel.size})</button>
          </div>
        </div>
      </div>

      <div className="page-body">
        {loading ? (
          <div className="loading-center"><div className="spinner dark" /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 4 }}>
              {[['En attente', pending.length, 'var(--accent)'], ['En retard', pending.filter(t => t.retard).length, 'var(--red)'], ['Colis à retourner', `${receivedCount}/${labels.length}`, 'var(--orange)']].map(([l, v, c]) => (
                <div key={l} style={{ background: 'var(--white)', borderRadius: 'var(--radius)', border: '1px solid var(--gray-200)', borderTop: `3px solid ${c}`, padding: '14px 16px', boxShadow: 'var(--shadow-sm)' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, color: c }}>{v}</div>
                  <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>{l}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <form onSubmit={scanReceive} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <ScanLine size={18} />
                <input className="form-input" style={{ maxWidth: 320 }} placeholder="Scanner un code-barres pour accuser réception" value={scan} onChange={e => setScan(e.target.value)} />
              </form>
              <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={showReturned} onChange={e => setShowReturned(e.target.checked)} /> Afficher les tournées rentrées
              </label>
            </div>

            {visible.length === 0 && (
              <div className="card"><div className="empty-state">
                <CheckCircle size={40} className="empty-state-icon" style={{ color: 'var(--green)' }} />
                <p className="empty-state-title">{tours.length ? 'Toutes les tournées sont rentrées !' : 'Aucune tournée pour cette date'}</p>
              </div></div>
            )}

            {visible.map(t => {
              const refName = refOf(t)
              const isUpdating = updating === t.id
              const ls = labelsByTour[refName] || []
              const rec = ls.filter(l => l.received_at).length
              const isOpen = open.has(t.id)
              return (
                <div key={t.id} className="card" style={{ overflow: 'hidden', borderLeft: t.heure_retour ? '4px solid var(--green)' : t.retard ? '4px solid var(--red)' : '4px solid transparent' }}>
                  <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 0, cursor: ls.length ? 'pointer' : 'default' }} onClick={() => ls.length && toggleOpen(t.id)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {ls.length > 0 && (isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16, color: 'var(--gray-800)' }}>{refName}</span>
                        {t.type_livraison && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 100, background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}>{t.type_livraison}</span>}
                        {t.heure_premiere_livraison && <span style={{ fontSize: 11, color: 'var(--gray-500)', display: 'flex', alignItems: 'center', gap: 3 }}><Clock size={11} /> {t.heure_premiere_livraison}</span>}
                        {t.code_postal_premiere_livraison && <span title="Code postal de la première livraison" style={{ fontSize: 11, color: 'var(--gray-500)', display: 'flex', alignItems: 'center', gap: 3 }}><MapPin size={11} /> {t.code_postal_premiere_livraison}</span>}
                        {t.heure_retour && <span className="badge badge-green">Rentrée à {hhmm(t.heure_retour)}</span>}
                      </div>
                      {ls.length > 0 && (
                        <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: rec === ls.length ? 'var(--green)' : 'var(--orange)' }}>
                          Colis à retourner : {rec}/{ls.length} réceptionnés
                        </div>
                      )}
                      {t.retard && !t.heure_retour && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                          <AlertTriangle size={12} color="var(--red)" />
                          <span style={{ fontSize: 12, color: 'var(--red)', fontWeight: 600 }}>Retard signalé</span>
                        </div>
                      )}
                    </div>
                    {!t.heure_retour && (
                      <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                        <button className="btn btn-sm" disabled={isUpdating} onClick={() => toggleRetard(t)}
                          style={{ background: t.retard ? '#fef2f2' : 'var(--white)', border: t.retard ? '1px solid #fca5a5' : '1px solid var(--gray-200)', color: t.retard ? 'var(--red)' : 'var(--gray-500)' }}>
                          <AlertTriangle size={13} /><span style={{ marginLeft: 4, fontSize: 12 }}>{t.retard ? 'Retard signalé' : 'Signaler retard'}</span>
                        </button>
                        <button className="btn btn-sm" disabled={isUpdating} onClick={() => confirmerRetour(t)} style={{ background: '#f0fdf4', border: '1px solid #a7f3d0', color: '#059669' }}>
                          {isUpdating ? <div className="spinner" style={{ width: 13, height: 13 }} /> : <><Clock size={13} /><span style={{ marginLeft: 4, fontSize: 12 }}>Confirmer retour</span></>}
                        </button>
                      </div>
                    )}
                  </div>
                  {isOpen && ls.length > 0 && <LabelsTable list={ls} name={refName} />}
                </div>
              )
            })}

            {orphanLabels.length > 0 && (
              <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => toggleOpen('orphans')}>
                  {open.has('orphans') ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <PackageX size={16} />
                  <span style={{ fontWeight: 700 }}>Colis à retourner sans tournée reconnue</span>
                  <span className="badge badge-gray">{orphanLabels.length}</span>
                </div>
                {open.has('orphans') && <LabelsTable list={orphanLabels} name="orphans" />}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
