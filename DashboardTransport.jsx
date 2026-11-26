import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { Truck, Clock, PackageX, AlertTriangle } from 'lucide-react'

// Règles (heures de Paris, créneau = tours.loading_slot du plan de chargement envoyé / enregistré)
const DEPART_RETARD_MIN = 60 // « Départ en retard » : départ réel du dépôt > créneau + 1 h
const ARRIVEE_RETARD_MIN = 10 // « Arrivée en retard » : premier scan > créneau + 10 min
const PARCELS_FROM = '2026-11-16' // début du suivi : colis à rapatrier et tournées non rentrées ignorent les jours précédents
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
  const [from, setFrom] = useState('2026-11-16')
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
    const get = k => (sup[k] = sup[k] || { name: k, withSlot: 0, depRetard: 0, arrRetard: 0, expected: 0, notBack: 0, parcels: 0, lateDep: [], lateArr: [], notBackList: [], parcelList: [], parcelsTotal: 0 })
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
      if (day >= PARCELS_FROM && day < today && dow !== 6 && dow !== 0 && withLabels.has(`${day}|${codeOf(t)}`)) {
        s.expected++
        const backSameDay = t.heure_retour && parisDay(t.heure_retour) <= day
        if (!backSameDay) { s.notBack++; s.notBackList.push({ day, code: codeOf(t), back: t.heure_retour ? `${fr(parisDay(t.heure_retour))} ${hhmm(t.heure_retour)}` : 'pas rentrée' }) }
      }
    }
    for (const l of labels) {
      if (l.task_date < today && l.task_date >= PARCELS_FROM && supplierOf.get(`${l.task_date}|${l.tour_code}`)) get(supplierOf.get(`${l.task_date}|${l.tour_code}`)).parcelsTotal++
      if (l.received_at || EXCLUDED_RECV.includes(l.reflex_recv_status) || l.task_date >= today || l.task_date < PARCELS_FROM) continue
      const sName = supplierOf.get(`${l.task_date}|${l.tour_code}`)
      if (!sName) continue // tournée non reconnue : signalée dans « Tournées de référence »
      const s = get(sName)
      s.parcels++; s.parcelList.push({ day: l.task_date, code: l.tour_code || '—', bp: l.barcode })
    }
    const rows = Object.values(sup)
    const ratio = (a, b) => (b ? a / b : null)
    for (const r of rows) r.ratios = [ratio(r.depRetard, r.withSlot), ratio(r.arrRetard, r.withSlot), ratio(r.notBack, r.expected), ratio(r.parcels, r.parcelsTotal)]
    // Score qualité /100 = 100 × (1 − moyenne pondérée des 4 proportions de défaut) ; une proportion sans donnée est ignorée
    const W = [25, 25, 30, 20] // départs en retard, arrivées en retard, non rentrées, colis à rapatrier
    for (const r of rows) {
      let w = 0, acc = 0
      r.ratios.forEach((v, i) => { if (v != null) { w += W[i]; acc += W[i] * Math.min(v, 1) } })
      r.quality = w ? Math.round(100 * (1 - acc / w)) : null
      r.score = r.quality == null ? Infinity : -r.quality
    }
    rows.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    rows.forEach((r, i) => { r.rank = r.score === Infinity ? null : i + 1 })
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
  return (
    <>
      <div className="page-header">
        <div className="flex items-center justify-between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div><h2 className="page-title">Dashboard - Transport</h2><p className="page-subtitle">Retards de départ et d'arrivée par fournisseur, tournées non rentrées et colis à rapatrier</p></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13 }}>Du <input type="date" className="form-input" style={{ width: 'auto', display: 'inline-block' }} value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} /></label>
          <label style={{ fontSize: 13 }}>au <input type="date" className="form-input" style={{ width: 'auto', display: 'inline-block' }} value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} /></label>
        </div>
        </div>
      </div>
      <div className="page-body">
      {error && <div className="card" style={{ padding: 12, color: 'var(--red)', marginBottom: 12 }}>Erreur : {error} (migrations <code>supabase_migration_loading_slot.sql</code>, <code>supabase_migration_depart_reel.sql</code> et <code>supabase_migration_premier_scan.sql</code> lancées ?)</div>}
      {loading ? <div className="loading-screen"><div className="spinner" /></div> : <>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <Card icon={<Clock size={14} />} label="Départs en retard" value={stats.tot.depRetard} sub={`> ${DEPART_RETARD_MIN} min après le créneau · ${stats.tot.withSlot} tournées avec créneau`} color={stats.tot.depRetard ? 'var(--red)' : undefined} />
          <Card icon={<Clock size={14} />} label="Arrivées en retard" value={stats.tot.arrRetard} sub={`premier scan > ${ARRIVEE_RETARD_MIN} min après le créneau`} color={stats.tot.arrRetard ? 'var(--red)' : undefined} />
          <Card icon={<Truck size={14} />} label="Non rentrées le jour même" value={pct(stats.tot.notBack, stats.tot.expected)} sub={`${stats.tot.notBack} sur ${stats.tot.expected} tournées attendues`} />
          <Card icon={<PackageX size={14} />} label="Colis en attente de rapatriement" value={stats.tot.parcels} sub="depuis le 16/11 · hors réceptionnés REFLEX et livrés" color={stats.tot.parcels ? 'var(--orange, #d97706)' : undefined} />
        </div>
        {stats.rows.length === 0 && <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--gray-400)' }}>Aucune tournée sur la période</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {stats.rows.map(r => {
            const q = r.quality
            const qc = q == null ? '#9ca3af' : q >= 90 ? '#12834F' : q >= 75 ? '#E0A100' : '#C0392B'
            const C = 2 * Math.PI * 34
            const pills = [
              ['dep', 'Départs en retard', r.depRetard, r.withSlot, r.ratios[0]],
              ['arr', 'Arrivées en retard', r.arrRetard, r.withSlot, r.ratios[1]],
              ['nb', 'Non rentrées', r.notBack, r.expected, r.ratios[2]],
              ['pc', 'Colis à rapatrier', r.parcels, r.parcelsTotal, r.ratios[3]],
            ]
            const pc = v => v == null ? ['#f3f4f6', '#6b7280'] : v === 0 ? ['#dcfce7', '#166534'] : v < 0.15 ? ['#fef3c7', '#92400e'] : ['#fee2e2', '#991b1b']
            return (
              <div key={r.name} className="card" style={{ padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                  <svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={`Score qualité ${q ?? 'non calculé'}`}>
                    <circle cx="42" cy="42" r="34" fill="none" stroke="#eef0f3" strokeWidth="9" />
                    {q != null && <circle cx="42" cy="42" r="34" fill="none" stroke={qc} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${C * q / 100} ${C}`} transform="rotate(-90 42 42)" />}
                    <text x="42" y="49" textAnchor="middle" fontSize="22" fontWeight="800" fill="#14181F">{q ?? '—'}</text>
                  </svg>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)' }}>{r.rank ? (r.rank === 1 ? '1er' : `${r.rank}e`) : '—'}</div>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>score qualité /100</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {pills.map(([k, label, n, tot, v]) => { const [bg, fg] = pc(v); const isOpen = open && open.n === r.name && open.k === k; return (
                    <button key={k} type="button" disabled={!n} onClick={() => setOpen(isOpen ? null : { n: r.name, k })} aria-expanded={isOpen}
                      style={{ background: bg, color: fg, border: isOpen ? `2px solid ${fg}` : '2px solid transparent', borderRadius: 12, padding: '10px 12px', textAlign: 'left', cursor: n ? 'pointer' : 'default', font: 'inherit' }}>
                      <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>{pct(n, tot)}</div>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{label}</div>
                      <div style={{ fontSize: 11, opacity: .8 }}>{n} / {tot}</div>
                    </button>) })}
                </div>
                {open && open.n === r.name && (() => { const list = { dep: r.lateDep, arr: r.lateArr, nb: r.notBackList, pc: r.parcelList }[open.k]; return list && list.length ? (
                  <div style={{ marginTop: 12, padding: 10, background: 'var(--gray-50, #f9fafb)', borderRadius: 8, fontSize: 12, maxHeight: 220, overflow: 'auto' }}>
                    {open.k === 'dep' && list.map((x, i) => <div key={i}>{fr(x.day)} — <b>{x.code}</b> : créneau {x.slot}, départ {x.real} (+{x.d} min)</div>)}
                    {open.k === 'arr' && list.map((x, i) => <div key={i}>{fr(x.day)} — <b>{x.code}</b> : créneau {x.slot}, premier scan {x.real} (+{x.d} min)</div>)}
                    {open.k === 'nb' && list.map((x, i) => <div key={i}>{fr(x.day)} — <b>{x.code}</b> : {x.back}</div>)}
                    {open.k === 'pc' && list.map((x, i) => <div key={i}>{fr(x.day)} — <b>{x.code}</b> : BP {x.bp}</div>)}
                  </div>) : null })()}
              </div>
            )
          })}
        </div>
        <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 10, lineHeight: 1.5 }}>
          <AlertTriangle size={12} style={{ verticalAlign: -2 }} /> Les retards se calculent sur les tournées dont le créneau a été enregistré (envoi ou « Enregistrer les créneaux » du plan de chargement) et dont l'heure Urbantz est connue. « Non rentrées le jour même » compte les jours passés (hors week-end) où la tournée avait des colis à retourner. Les colis en attente excluent ceux réceptionnés dans REFLEX ou livrés. Les pourcentages sont : départs et arrivées en retard sur les tournées avec créneau, non rentrées sur les tournées attendues, colis à rapatrier sur les colis à retourner (depuis le 16/11). Score qualité (sur 100) = 100 moins la moyenne pondérée de ces quatre pourcentages (départs en retard 25 %, arrivées en retard 25 %, non rentrées 30 %, colis à rapatrier 20 %) ; le classement va du meilleur score au moins bon. Les tournées non reconnues sont signalées dans « Tournées de référence ».
        </p>
      </>}
      </div>
    </>
  )
}

