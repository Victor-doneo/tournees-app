import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { Truck, Clock, PackageX, AlertTriangle } from 'lucide-react'

// Règles (heures de Paris, créneau = tours.loading_slot du plan de chargement envoyé / enregistré)
const DEPART_RETARD_MIN = 60 // « Départ en retard » : départ réel du dépôt > créneau + 1 h
const ARRIVEE_RETARD_MIN = 10 // « Arrivée en retard » : premier scan > créneau + 10 min
const PARCELS_FROM = '2026-11-16' // colis à rapatrier : suivis seulement à partir du 16/11/2026
const EXCLUDED_RECV = ['receptionne', 'livre'] // colis déjà réceptionné dans REFLEX / livré : pas en attente de rapatriement

const parisDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(d))
const parisMin = d => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(d)).map(x => [x.type, x.value])); return Number(p.hour) * 60 + Number(p.minute) }
const dayDiff = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 864e5)
const hhmm = d => d ? new Date(d).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }) : '—'
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const fr = d => d.split('-').reverse().join('/')
// minutes d'écart entre un instant réel et le créneau (HH:MM[:SS]) du jour de livraison
const delta = (iso, day, slot) => { const [h, m] = String(slot).split(':').map(Number); return dayDiff(parisDay(iso), day) * 1440 + parisMin(iso) - (h * 60 + m) }

async function fetchAll(build) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

export default function DashboardTransport() {
  const today = parisDay(new Date())
  const [from, setFrom] = useState(addDays(today, -13))
  const [to, setTo] = useState(today)
  const [tours, setTours] = useState([])
  const [labels, setLabels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)

  useEffect(() => { load() }, [from, to])
  async function load() {
    setLoading(true); setError('')
    try {
      const t = await fetchAll(() => supabase.from('tours')
        .select('id, name, heure_retour, loading_slot, urbantz_depart_reel, urbantz_premier_scan, tours_references(name, name_supplier), delivery_dates!inner(delivery_date)')
        .gte('delivery_dates.delivery_date', from).lte('delivery_dates.delivery_date', to).order('id'))
      const l = await fetchAll(() => supabase.from('return_labels')
        .select('id, task_date, tour_code, barcode, received_at, reflex_recv_status').gte('task_date', from).lte('task_date', to).order('id'))
      setTours(t); setLabels(l)
    } catch (e) { setError(e.message || String(e)) }
    setLoading(false)
  }

  const stats = useMemo(() => {
    const sup = {}
    const get = k => (sup[k] = sup[k] || { name: k, withSlot: 0, depRetard: 0, arrRetard: 0, expected: 0, notBack: 0, parcels: 0, lateDep: [], lateArr: [], notBackList: [], parcelList: [] })
    const supplierOf = new Map() // `${jour}|${code}` -> fournisseur
    const dayOfTour = t => t.delivery_dates?.delivery_date
    const codeOf = t => t.tours_references?.name || t.name
    const suppOf = t => (t.tours_references?.name_supplier || '').trim() || 'Sans fournisseur'
    for (const t of tours) supplierOf.set(`${dayOfTour(t)}|${codeOf(t)}`, suppOf(t))
    const withLabels = new Set(labels.map(l => `${l.task_date}|${l.tour_code}`))
    for (const t of tours) {
      const day = dayOfTour(t), s = get(suppOf(t))
      if (t.loading_slot) {
        s.withSlot++
        if (t.urbantz_depart_reel) { const d = delta(t.urbantz_depart_reel, day, t.loading_slot); if (d > DEPART_RETARD_MIN) { s.depRetard++; s.lateDep.push({ day, code: codeOf(t), slot: String(t.loading_slot).slice(0, 5), real: hhmm(t.urbantz_depart_reel), d }) } }
        if (t.urbantz_premier_scan) { const d = delta(t.urbantz_premier_scan, day, t.loading_slot); if (d > ARRIVEE_RETARD_MIN) { s.arrRetard++; s.lateArr.push({ day, code: codeOf(t), slot: String(t.loading_slot).slice(0, 5), real: hhmm(t.urbantz_premier_scan), d }) } }
      }
      // Tournée attendue = elle a des colis à retourner ; jours passés seulement, hors samedi/dimanche
      const dow = new Date(day + 'T12:00:00').getDay()
      if (day < today && dow !== 6 && dow !== 0 && withLabels.has(`${day}|${codeOf(t)}`)) {
        s.expected++
        const backSameDay = t.heure_retour && parisDay(t.heure_retour) <= day
        if (!backSameDay) { s.notBack++; s.notBackList.push({ day, code: codeOf(t), back: t.heure_retour ? `${fr(parisDay(t.heure_retour))} ${hhmm(t.heure_retour)}` : 'pas rentrée' }) }
      }
    }
    for (const l of labels) {
      if (l.received_at || EXCLUDED_RECV.includes(l.reflex_recv_status) || l.task_date >= today || l.task_date < PARCELS_FROM) continue
      const s = get(supplierOf.get(`${l.task_date}|${l.tour_code}`) || 'Tournée non reconnue')
      s.parcels++; s.parcelList.push({ day: l.task_date, code: l.tour_code || '—', bp: l.barcode })
    }
    const rows = Object.values(sup).sort((a, b) => a.name.localeCompare(b.name))
    const sum = k => rows.reduce((a, r) => a + r[k], 0)
    return { rows, tot: { withSlot: sum('withSlot'), depRetard: sum('depRetard'), arrRetard: sum('arrRetard'), expected: sum('expected'), notBack: sum('notBack'), parcels: sum('parcels') } }
  }, [tours, labels, today])

  const pct = (a, b) => (b ? `${Math.round(100 * a / b)} %` : '—')
  const Card = ({ icon, label, value, sub, color }) => (
    <div className="card" style={{ padding: 16, flex: '1 1 200px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--gray-500)', fontWeight: 600 }}>{icon}{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || 'var(--gray-800)', marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
  const detail = (r, kind) => {
    const lists = { dep: r.lateDep, arr: r.lateArr, nb: r.notBackList, pc: r.parcelList }
    const list = lists[kind]
    if (!list.length) return null
    return (
      <tr><td colSpan={8} style={{ background: 'var(--gray-50, #f9fafb)', padding: '8px 16px', fontSize: 12 }}>
        {kind === 'dep' && list.map((x, i) => <div key={i}>{fr(x.day)} — <b>{x.code}</b> : créneau {x.slot}, départ {x.real} (+{x.d} min)</div>)}
        {kind === 'arr' && list.map((x, i) => <div key={i}>{fr(x.day)} — <b>{x.code}</b> : créneau {x.slot}, premier scan {x.real} (+{x.d} min)</div>)}
        {kind === 'nb' && list.map((x, i) => <div key={i}>{fr(x.day)} — <b>{x.code}</b> : {x.back}</div>)}
        {kind === 'pc' && list.map((x, i) => <div key={i}>{fr(x.day)} — <b>{x.code}</b> : BP {x.bp}</div>)}
      </td></tr>
    )
  }
  const cellBtn = (r, kind, n, red) => <td style={{ textAlign: 'right' }}>{n ? <button className="btn btn-ghost btn-sm" style={{ color: red ? 'var(--red)' : undefined, fontWeight: 700 }} onClick={() => setOpen(open && open.n === r.name && open.k === kind ? null : { n: r.name, k: kind })}>{n}</button> : <span style={{ color: 'var(--gray-400)' }}>0</span>}</td>

  return (
    <>
      <div className="page-header">
        <div><h2 className="page-title">Dashboard - Transport</h2><p className="page-subtitle">Retards de départ et d'arrivée par fournisseur, tournées non rentrées et colis à rapatrier</p></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13 }}>Du <input type="date" className="form-input" style={{ width: 'auto', display: 'inline-block' }} value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} /></label>
          <label style={{ fontSize: 13 }}>au <input type="date" className="form-input" style={{ width: 'auto', display: 'inline-block' }} value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} /></label>
        </div>
      </div>
      {error && <div className="card" style={{ padding: 12, color: 'var(--red)', marginBottom: 12 }}>Erreur : {error} (migrations <code>supabase_migration_loading_slot.sql</code>, <code>supabase_migration_depart_reel.sql</code> et <code>supabase_migration_premier_scan.sql</code> lancées ?)</div>}
      {loading ? <div className="loading-screen"><div className="spinner" /></div> : <>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <Card icon={<Clock size={14} />} label="Départs en retard" value={stats.tot.depRetard} sub={`> ${DEPART_RETARD_MIN} min après le créneau · ${stats.tot.withSlot} tournées avec créneau`} color={stats.tot.depRetard ? 'var(--red)' : undefined} />
          <Card icon={<Clock size={14} />} label="Arrivées en retard" value={stats.tot.arrRetard} sub={`premier scan > ${ARRIVEE_RETARD_MIN} min après le créneau`} color={stats.tot.arrRetard ? 'var(--red)' : undefined} />
          <Card icon={<Truck size={14} />} label="Non rentrées le jour même" value={pct(stats.tot.notBack, stats.tot.expected)} sub={`${stats.tot.notBack} sur ${stats.tot.expected} tournées attendues`} />
          <Card icon={<PackageX size={14} />} label="Colis en attente de rapatriement" value={stats.tot.parcels} sub="depuis le 16/11 · hors réceptionnés REFLEX et livrés" color={stats.tot.parcels ? 'var(--orange, #d97706)' : undefined} />
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="table-wrapper"><table>
            <thead><tr><th>Fournisseur</th><th style={{ textAlign: 'right' }}>Tournées avec créneau</th><th style={{ textAlign: 'right' }}>Départs en retard</th><th style={{ textAlign: 'right' }}>Arrivées en retard</th><th style={{ textAlign: 'right' }}>Tournées attendues</th><th style={{ textAlign: 'right' }}>Non rentrées le jour même</th><th style={{ textAlign: 'right' }}>Proportion</th><th style={{ textAlign: 'right' }}>Colis à rapatrier</th></tr></thead>
            <tbody>
              {stats.rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--gray-400)' }}>Aucune tournée sur la période</td></tr>}
              {stats.rows.map(r => [
                <tr key={r.name}>
                  <td style={{ fontWeight: 700 }}>{r.name}</td>
                  <td style={{ textAlign: 'right' }}>{r.withSlot}</td>
                  {cellBtn(r, 'dep', r.depRetard, true)}
                  {cellBtn(r, 'arr', r.arrRetard, true)}
                  <td style={{ textAlign: 'right' }}>{r.expected}</td>
                  {cellBtn(r, 'nb', r.notBack, true)}
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{pct(r.notBack, r.expected)}</td>
                  {cellBtn(r, 'pc', r.parcels, true)}
                </tr>,
                open && open.n === r.name ? <Fragment2 key={r.name + 'd'}>{detail(r, open.k)}</Fragment2> : null,
              ])}
            </tbody>
          </table></div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 10, lineHeight: 1.5 }}>
          <AlertTriangle size={12} style={{ verticalAlign: -2 }} /> Les retards se calculent sur les tournées dont le créneau a été enregistré (envoi ou « Enregistrer les créneaux » du plan de chargement) et dont l'heure Urbantz est connue. « Non rentrées le jour même » compte les jours passés (hors week-end) où la tournée avait des colis à retourner. Les colis en attente excluent ceux réceptionnés dans REFLEX ou livrés.
        </p>
      </>}
    </>
  )
}

const Fragment2 = ({ children }) => children
