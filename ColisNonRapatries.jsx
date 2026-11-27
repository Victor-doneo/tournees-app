import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { useSearchParams } from 'react-router-dom'
import { PackageX, Download, RefreshCw } from 'lucide-react'
import { useAuth } from './AuthContext'

const FROM = '2026-11-16' // début du suivi
const EXCLUDED_RECV = ['receptionne', 'livre'] // déjà réceptionné dans REFLEX / livré : pas à rapatrier
const parisDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(d))
const dayDiff = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 864e5)
const fr = d => d.split('-').reverse().join('/')

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

export default function ColisNonRapatries() {
  const today = parisDay(new Date())
  const [labels, setLabels] = useState([])
  const [tours, setTours] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { profile } = useAuth()
  const [recheckMsg, setRecheckMsg] = useState('')
  const [rechecking, setRechecking] = useState(false)
  const [params] = useSearchParams()
  const [supplier, setSupplier] = useState(params.get('supplier') || '')
  const [q, setQ] = useState('')
  const [minAge, setMinAge] = useState(0)

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true); setError('')
    try {
      const t = await fetchAll(() => supabase.from('tours')
        .select('id, name, tours_references(name, name_supplier), delivery_dates!inner(delivery_date)')
        .gte('delivery_dates.delivery_date', FROM).lt('delivery_dates.delivery_date', today).order('id'))
      const l = await fetchAll(() => supabase.from('return_labels')
        .select('id, task_date, tour_code, round_name, barcode, reason, received_at, reflex_recv_status, reflex_recv_checked_at')
        .gte('task_date', FROM).lt('task_date', today).is('received_at', null).order('id'))
      setTours(t); setLabels(l)
    } catch (e) { setError(e.message || String(e)) }
    setLoading(false)
  }

  const rows = useMemo(() => {
    const supplierOf = new Map()
    for (const t of tours) supplierOf.set(`${t.delivery_dates?.delivery_date}|${t.tours_references?.name || t.name}`, (t.tours_references?.name_supplier || '').trim() || 'Sans fournisseur')
    return labels
      .filter(l => !EXCLUDED_RECV.includes(l.reflex_recv_status))
      .map(l => ({ ...l, supplier: supplierOf.get(`${l.task_date}|${l.tour_code}`) || 'Tournée non reconnue', age: dayDiff(today, l.task_date) }))
  }, [labels, tours, today])

  const suppliers = useMemo(() => [...new Set(rows.map(r => r.supplier))].sort(), [rows])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows.filter(r => (!supplier || r.supplier === supplier) && r.age >= minAge && (!s || `${r.barcode} ${r.tour_code || ''} ${r.round_name || ''}`.toLowerCase().includes(s)))
      .sort((a, b) => a.task_date.localeCompare(b.task_date) || String(a.tour_code).localeCompare(String(b.tour_code)) || String(a.barcode).localeCompare(String(b.barcode)))
  }, [rows, supplier, q, minAge])

  const groups = useMemo(() => {
    const g = new Map()
    for (const r of shown) { const k = `${r.task_date}|${r.tour_code || r.round_name || '—'}`; if (!g.has(k)) g.set(k, { day: r.task_date, code: r.tour_code || r.round_name || '—', supplier: r.supplier, items: [] }); g.get(k).items.push(r) }
    return [...g.values()]
  }, [shown])

  async function recheck() {
    if (!shown.length) return
    setRechecking(true); setRecheckMsg('')
    const { data, error: e } = await supabase.rpc('request_reflex_recheck', { p_ids: shown.map(l => l.id) })
    setRechecking(false)
    setRecheckMsg(e ? `Erreur : ${e.message} (migration supabase_migration_reflex_recheck.sql lancée ?)` : `${data ?? shown.length} colis mis en file : REFLEX les revérifie au prochain passage (toutes les 5 min, ~25 BP par passage). Recharge la page dans quelques minutes.`)
  }
  function exportCsv() {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = ['Date;Tournée;Fournisseur;BP;Motif;Jours', ...shown.map(r => [fr(r.task_date), r.tour_code || r.round_name || '', r.supplier, r.barcode, r.reason || '', r.age].map(esc).join(';'))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `colis-non-rapatries-${today}.csv`; a.click()
  }

  return (
    <>
      <div className="page-header">
        <div><h2 className="page-title">Colis non rapatriés</h2><p className="page-subtitle">Colis à retourner dont la tournée est passée, non réceptionnés (hors jour même)</p></div>
      </div>
      <div className="page-body">
        {error && <div className="card" style={{ padding: 12, color: 'var(--red, #b91c1c)', marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <div className="card" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <PackageX size={16} /> <b style={{ fontSize: 22 }}>{shown.length}</b> colis · {groups.length} tournée{groups.length > 1 ? 's' : ''}
          </div>
          <select className="form-input" style={{ width: 'auto' }} value={supplier} onChange={e => setSupplier(e.target.value)} aria-label="Fournisseur">
            <option value="">Tous les fournisseurs</option>
            {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="form-input" style={{ width: 'auto' }} value={minAge} onChange={e => setMinAge(Number(e.target.value))} aria-label="Ancienneté">
            <option value={0}>Tous les âges</option>
            <option value={2}>Depuis 2 jours ou plus</option>
            <option value={3}>Depuis plus de 3 jours</option>
            <option value={5}>Depuis 5 jours ou plus</option>
          </select>
          <input className="form-input" style={{ width: 220 }} placeholder="Rechercher BP, tournée…" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher" />
          <button type="button" className="btn btn-secondary" onClick={exportCsv} disabled={!shown.length}><Download size={14} /> Exporter CSV</button>
          {profile?.role !== 'carrier' && <button type="button" className="btn btn-secondary" onClick={recheck} disabled={!shown.length || rechecking}><RefreshCw size={14} /> {rechecking ? 'Envoi…' : 'Revérifier dans REFLEX'}</button>}
        </div>
        {recheckMsg && <div className="card" style={{ padding: 10, marginBottom: 10, fontSize: 13 }}>{recheckMsg}</div>}
        {loading ? <div className="card" style={{ padding: 24, textAlign: 'center' }}>Chargement…</div>
          : !groups.length ? <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--gray-400)' }}>Aucun colis non rapatrié</div>
          : groups.map(g => (
            <div key={`${g.day}|${g.code}`} className="card" style={{ marginBottom: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--gray-50, #f9fafb)', borderBottom: '1px solid var(--gray-200, #e5e7eb)' }}>
                <div><b>{g.code}</b> · {fr(g.day)} · <span style={{ color: 'var(--gray-500)' }}>{g.supplier}</span></div>
                <span style={{ fontSize: 12, fontWeight: 700, background: g.items[0].age >= 3 ? '#fee2e2' : '#fef3c7', color: g.items[0].age >= 3 ? '#991b1b' : '#92400e', borderRadius: 999, padding: '2px 10px' }}>{g.items.length} colis · J+{g.items[0].age}</span>
              </div>
              <div className="table-wrapper"><table><thead><tr><th>BP</th><th>Motif</th><th>REFLEX</th></tr></thead><tbody>
                {g.items.map(r => <tr key={r.id}><td style={{ fontFamily: 'monospace' }}>{r.barcode}</td><td>{r.reason || '—'}</td><td>{r.reflex_recv_status === 'manquant' || r.reflex_recv_status === 'introuvable' ? `Non réceptionné${r.reflex_recv_checked_at ? ' (contrôlé le ' + new Date(r.reflex_recv_checked_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ')' : ''}` : 'Pas encore vérifié'}</td></tr>)}
              </tbody></table></div>
            </div>
          ))}
      </div>
    </>
  )
}
