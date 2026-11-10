import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import toast from 'react-hot-toast'
import { LayoutGrid, Shuffle, Copy, RotateCcw, AlertTriangle, Send } from 'lucide-react'
import { DEFAULT_TEMPLATE, renderSubject } from './mailTemplate'
import { QUAIS, fmtMin, parseHM, distanceKm, travelMinutes, generatePlan, shuffleQuais } from './chargementPlan'

const ALL_SLOTS = Array.from({ length: 19 }, (_, i) => 330 + i * 30) // 05:30 -> 14:30
const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

export default function PlanChargement() {
  const [dates, setDates] = useState([])
  const [date, setDate] = useState(null)
  const [rows, setRows] = useState([])
  const [coords, setCoords] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lv1Km, setLv1Km] = useState(5)
  const [lv1Min, setLv1Min] = useState(10)
  const [mode, setMode] = useState('time') // 'time' = temps de trajet avec trafic moyen, 'distance' = km à vol d'oiseau
  const [capacity, setCapacity] = useState(9)
  const [seed, setSeed] = useState(1)
  const [plan, setPlan] = useState([])
  const [sending, setSending] = useState(false)

  // coordonnées des codes postaux : fichier chargé à la demande (pas dans le bundle principal)
  useEffect(() => { import('./cpCoords.json').then(m => setCoords(m.default)) }, [])

  useEffect(() => {
    supabase.from('delivery_dates').select('id, delivery_date').order('delivery_date', { ascending: false }).limit(40)
      .then(({ data, error }) => {
        if (error) { toast.error('Erreur : ' + error.message); setLoading(false); return }
        setDates(data || [])
        // Après midi, on prépare le lendemain : on prend la prochaine journée APRÈS aujourd'hui ;
        // le matin, on garde la journée du jour. À défaut, la plus récente.
        const now = new Date()
        const today = now.toLocaleDateString('en-CA')
        const asc = [...(data || [])].reverse()
        const next = (now.getHours() >= 12 ? asc.find(d => d.delivery_date > today) : null)
          || asc.find(d => d.delivery_date >= today) || data?.[0]
        if (next) setDate(next)
        else setLoading(false)
      })
  }, [])

  useEffect(() => { if (date) loadTours(date) }, [date])

  async function loadTours(d) {
    setLoading(true)
    const { data, error } = await supabase
      .from('tours')
      .select('id, name, type_livraison, heure_premiere_livraison, code_postal_premiere_livraison, total_parcels, tours_references(name)')
      .eq('delivery_date_id', d.id)
    if (error) toast.error('Erreur : ' + error.message)
    setRows(data || [])
    setLoading(false)
  }

  const tours = useMemo(() => {
    if (!coords) return []
    return rows.map(r => {
      const cp = r.code_postal_premiere_livraison ? String(r.code_postal_premiere_livraison).padStart(5, '0') : null
      const dist = cp ? distanceKm(coords, cp) : null
      const hpl = parseHM(r.heure_premiere_livraison)
      return {
      id: r.id,
      name: r.tours_references?.name || r.name,
      hpl,
      lv1: r.type_livraison === 'LV1',
      type: r.type_livraison,
      cp: r.code_postal_premiere_livraison,
      dist,
      trip: travelMinutes(dist, cp ? coords[cp] : null, hpl),
      colis: r.total_parcels,
    }})
  }, [rows, coords])

  // recalcul du plan quand les données ou les réglages changent
  useEffect(() => { setPlan(tours.length ? generatePlan(tours, { mode, lv1Km, lv1Min, capacity: Math.min(capacity, QUAIS.length), seed }) : []) }, [tours, mode, lv1Km, lv1Min, capacity])

  function reshuffleQuais() {
    const s = seed + 1
    setSeed(s)
    setPlan(p => shuffleQuais(p, s))
  }

  function edit(id, patch) { setPlan(p => p.map(t => (t.id === id ? { ...t, ...patch } : t))) }

  const conflicts = useMemo(() => {
    const seen = {}, bad = new Set()
    plan.forEach(t => { const k = `${t.slot}-${t.quai}`; if (t.quai != null && seen[k]) { bad.add(t.id); bad.add(seen[k]) } else seen[k] = t.id })
    return bad
  }, [plan])

  const slots = [...new Set(plan.map(t => t.slot))].sort((a, b) => a - b)
  const cell = (s, q) => plan.filter(t => t.slot === s && t.quai === q)

  // Tableau créneaux × quais envoyé dans le mail (l'introduction et la signature viennent du modèle, côté serveur)
  function buildTableHtml() {
    const head = ['', ...QUAIS.map(q => `QUAI ${q}`)]
    const lines = slots.map(s => [fmtMin(s), ...QUAIS.map(q => cell(s, q).map(t => t.name).join(' / '))])
    const th = 'style="border:1px solid #999;padding:4px 8px;background:#eee"', td = 'style="border:1px solid #999;padding:4px 8px"'
    return `<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt"><tr>${head.map(h => `<th ${th}>${h}</th>`).join('')}</tr>${lines.map(r => `<tr>${r.map(c => `<td ${td}>${c}</td>`).join('')}</tr>`).join('')}</table>`
  }

  async function sendMail() {
    if (!date || !plan.length) return
    const [y, m, d] = date.delivery_date.split('-')
    try {
      setSending(true)
      const { data: prev } = await supabase.from('loading_plan_sends').select('sent_at').eq('delivery_date', date.delivery_date).order('sent_at', { ascending: false }).limit(1)
      const warn = prev?.length ? `\n\nAttention : un plan a déjà été envoyé pour cette journée le ${new Date(prev[0].sent_at).toLocaleString('fr-FR')}.` : ''
      const { data: tpl } = await supabase.from('loading_plan_mail_template').select('subject, greeting, intro, signature').eq('id', 1).maybeSingle()
      if (!confirm(`Envoyer le plan de chargement du ${d}.${m}.${y} aux destinataires actifs ?\nObjet : ${renderSubject(tpl || DEFAULT_TEMPLATE, date.delivery_date)}${warn}`)) return
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-loading-plan`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery_date: date.delivery_date, table_html: buildTableHtml() }),
      })
      const out = await res.json().catch(() => ({}))
      if (res.ok) toast.success(`Plan envoyé à ${out.sent_to} destinataire(s)`)
      else toast.error(out.error || 'Envoi impossible')
    } catch (e) { toast.error('Erreur : ' + e.message) } finally { setSending(false) }
  }

  async function copyTable() {
    const head = ['', ...QUAIS.map(q => `QUAI ${q}`)]
    const lines = slots.map(s => [fmtMin(s), ...QUAIS.map(q => cell(s, q).map(t => t.name).join(' / '))])
    const text = [head, ...lines].map(r => r.join('\t')).join('\n')
    const th = 'style="border:1px solid #999;padding:4px 8px;background:#eee"', td = 'style="border:1px solid #999;padding:4px 8px"'
    const html = `<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt"><tr>${head.map(h => `<th ${th}>${h}</th>`).join('')}</tr>${lines.map(r => `<tr>${r.map(c => `<td ${td}>${c}</td>`).join('')}</tr>`).join('')}</table>`
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
      toast.success('Tableau copié : collez-le dans votre mail ou dans Excel')
    } catch {
      try { await navigator.clipboard.writeText(text); toast.success('Tableau copié (texte)') } catch { toast.error('Copie impossible') }
    }
  }

  const unknownDist = tours.filter(t => t.dist == null).length
  const unknownHpl = tours.filter(t => t.hpl == null).length

  return (
    <>
      <div className="page-header">
        <h2 className="page-title">Plan de chargement</h2>
        <p className="page-subtitle">Proposition automatique : heure de première livraison, puis temps de trajet estimé depuis Antony (calibré sur les trajets réels Urbantz) ou distance, LV1 comptée comme plus loin. Quais placés au hasard.</p>
      </div>

      <div className="page-body">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <select className="form-input" style={{ maxWidth: 260 }} value={date?.id || ''} onChange={e => setDate(dates.find(d => String(d.id) === e.target.value))}>
            {dates.map(d => <option key={d.id} value={d.id}>{fmtDate(d.delivery_date)}</option>)}
          </select>
          <select className="form-input" style={{ maxWidth: 230 }} value={mode} onChange={e => setMode(e.target.value)} title="Critère de tri après l'heure de première livraison">
            <option value="time">Temps de trajet estimé</option>
            <option value="distance">Distance à vol d'oiseau</option>
          </select>
          {mode === 'time' ? (
            <label style={{ fontSize: 13, color: 'var(--gray-600)', display: 'flex', alignItems: 'center', gap: 6 }}>
              LV1 = +
              <input type="number" className="form-input" style={{ width: 70 }} min={0} max={60} value={lv1Min} onChange={e => setLv1Min(Number(e.target.value) || 0)} /> min
            </label>
          ) : (
            <label style={{ fontSize: 13, color: 'var(--gray-600)', display: 'flex', alignItems: 'center', gap: 6 }}>
              LV1 = +
              <input type="number" className="form-input" style={{ width: 70 }} min={0} max={30} value={lv1Km} onChange={e => setLv1Km(Number(e.target.value) || 0)} /> km
            </label>
          )}
          <label style={{ fontSize: 13, color: 'var(--gray-600)', display: 'flex', alignItems: 'center', gap: 6 }}>
            Max par créneau
            <input type="number" className="form-input" style={{ width: 70 }} min={1} max={9} value={capacity} onChange={e => setCapacity(Math.max(1, Math.min(9, Number(e.target.value) || 9)))} />
          </label>
          <button className="btn btn-secondary btn-sm" onClick={reshuffleQuais}><Shuffle size={14} /> Mélanger les quais</button>
          <button className="btn btn-secondary btn-sm" onClick={() => { setSeed(s => s + 1); setPlan(generatePlan(tours, { mode, lv1Km, lv1Min, capacity: Math.min(capacity, QUAIS.length), seed: seed + 1 })) }}><RotateCcw size={14} /> Recalculer</button>
          <button className="btn btn-primary btn-sm" onClick={copyTable} disabled={!plan.length}><Copy size={14} /> Copier le tableau</button>
          <button className="btn btn-primary btn-sm" onClick={sendMail} disabled={!plan.length || sending}>{sending ? <><div className="spinner" /> Envoi...</> : <><Send size={14} /> Envoyer par mail</>}</button>
        </div>

        {(unknownDist > 0 || unknownHpl > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--orange)', marginBottom: 12 }}>
            <AlertTriangle size={14} />
            {unknownDist > 0 && <>{unknownDist} tournée(s) sans code postal (distance comptée à 0 km). </>}
            {unknownHpl > 0 && <>{unknownHpl} sans heure de première livraison (traitées comme 06:00).</>}
          </div>
        )}

        {loading || !coords ? (
          <div className="loading-center"><div className="spinner dark" /></div>
        ) : plan.length === 0 ? (
          <div className="card"><div className="empty-state">
            <LayoutGrid size={36} className="empty-state-icon" />
            <p className="empty-state-title">Aucune tournée</p>
            <p className="empty-state-sub">Importez le PDF de cette journée pour générer un plan.</p>
          </div></div>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="table-wrapper">
                <table>
                  <thead><tr><th></th>{QUAIS.map(q => <th key={q} style={{ textAlign: 'center' }}>QUAI {q}</th>)}</tr></thead>
                  <tbody>
                    {slots.map(s => (
                      <tr key={s}>
                        <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtMin(s)}</td>
                        {QUAIS.map(q => (
                          <td key={q} style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 13 }}>
                            {cell(s, q).map(t => (
                              <span key={t.id} title={`${t.lv1 ? 'LV1 · ' : ''}${t.dist != null ? Math.round(t.dist) + ' km · ~' + Math.round(t.trip) + ' min' : 'distance inconnue'}`}
                                style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4, background: conflicts.has(t.id) ? '#fee2e2' : t.lv1 ? '#eff6ff' : 'var(--gray-100)', color: t.lv1 ? '#1e40af' : 'inherit' }}>
                                {t.name}
                              </span>
                            ))}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Tournée</th><th>1re livraison</th><th>Code postal</th><th>Distance</th><th>Trajet estimé</th><th>Type</th><th>Colis</th><th>Créneau</th><th>Quai</th></tr></thead>
                  <tbody>
                    {plan.map(t => (
                      <tr key={t.id}>
                        <td style={{ fontWeight: 600 }}>{t.name}{t.overflow && <span className="badge badge-orange" style={{ marginLeft: 6 }} title="Créneaux habituels complets">report</span>}</td>
                        <td>{t.hpl != null ? fmtMin(t.hpl) : '—'}</td>
                        <td>{t.cp || '—'}</td>
                        <td>{t.dist != null ? `${Math.round(t.dist)} km` : '—'}</td>
                        <td>{t.trip != null ? `~${Math.round(t.trip)} min` : '—'}</td>
                        <td>{t.type ? <span className={`badge ${t.lv1 ? 'badge-blue' : 'badge-gray'}`}>{t.type}</span> : '—'}</td>
                        <td>{t.colis ?? '—'}</td>
                        <td>
                          <select className="form-input" style={{ width: 90 }} value={t.slot} onChange={e => edit(t.id, { slot: Number(e.target.value) })}>
                            {[...new Set([...ALL_SLOTS, t.slot])].sort((a, b) => a - b).map(s => <option key={s} value={s}>{fmtMin(s)}</option>)}
                          </select>
                        </td>
                        <td>
                          <select className="form-input" style={{ width: 80, borderColor: conflicts.has(t.id) ? 'var(--red)' : undefined }} value={t.quai ?? ''} onChange={e => edit(t.id, { quai: Number(e.target.value) })}>
                            {t.quai == null && <option value="">?</option>}
                            {QUAIS.map(q => <option key={q} value={q}>{q}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {conflicts.size > 0 && <p style={{ fontSize: 13, color: 'var(--red)', marginTop: 10 }}>Deux tournées ont le même créneau et le même quai : modifiez l'une des deux.</p>}
          </>
        )}
      </div>
    </>
  )
}
