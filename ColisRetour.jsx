import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import toast from 'react-hot-toast'
import { Printer, RefreshCw, PackageX, CheckCircle, ChevronDown, ChevronRight, ScanLine } from 'lucide-react'
import { code128Svg } from './code128'
import { useAuth } from './AuthContext'

const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' })
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function labelHtml(r) {
  return `<div class="label">
    <div class="top"><b>${esc(r.tour_code || r.round_name || '')}</b><span>${esc(new Date(r.task_date + 'T12:00:00').toLocaleDateString('fr-FR'))}</span></div>
    <div class="bc">${code128Svg(r.barcode)}</div>
    <div class="code">${esc(r.barcode)}</div>
    <div class="item">${esc(r.item_name || '')}<br><small>${esc((r.item_description || '').slice(0, 90))}</small></div>
    <div class="cust"><b>${esc(r.customer_name || '')}</b><br>${esc(r.address || '')}<br>${esc([r.zip, r.city].filter(Boolean).join(' '))}${r.customer_phone ? '<br>Tél. ' + esc(r.customer_phone) : ''}</div>
    <div class="reason">${esc(r.reason || '')}</div>
  </div>`
}

function printLabels(rows) {
  const w = window.open('', '_blank')
  if (!w) return toast.error('Autorisez les fenêtres pop-up pour imprimer')
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Étiquettes retour</title><style>
    @page{size:100mm 150mm;margin:0}
    body{margin:0;font-family:Arial,sans-serif}
    .label{box-sizing:border-box;width:100mm;height:150mm;padding:6mm;page-break-after:always;display:flex;flex-direction:column;gap:3mm}
    .top{display:flex;justify-content:space-between;font-size:16pt}
    .bc{height:28mm}.bc svg{width:100%;height:28mm}
    .code{text-align:center;font:bold 16pt monospace;letter-spacing:1px}
    .item{font-size:12pt}.item small{font-size:9pt;color:#333}
    .cust{font-size:13pt;border:1.5px solid #000;padding:3mm;flex:1}
    .reason{text-align:center;font:bold 14pt Arial;border:2px solid #000;padding:2mm}
  </style></head><body>${rows.map(labelHtml).join('')}<script>onload=()=>setTimeout(()=>print(),300)</script></body></html>`)
  w.document.close()
}

export default function ColisRetour() {
  const [day, setDay] = useState(todayStr())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(new Set())
  const [open, setOpen] = useState(new Set())
  const [scan, setScan] = useState('')
  const { user } = useAuth()

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('return_labels').select('*').eq('task_date', day).order('round_name').order('customer_name')
    if (error) toast.error(error.message)
    setRows(data || []); setSel(new Set()); setLoading(false)
  }
  useEffect(() => { load() }, [day])

  const groups = useMemo(() => {
    const g = {}
    rows.forEach(r => { (g[r.tour_code || r.round_name || '—'] = g[r.tour_code || r.round_name || '—'] || []).push(r) })
    return Object.entries(g)
  }, [rows])

  async function print(list) {
    if (!list.length) return toast.error('Aucune étiquette sélectionnée')
    printLabels(list)
    await supabase.from('return_labels').update({ printed_at: new Date().toISOString() }).in('id', list.map(r => r.id))
    load()
  }
  async function receive(list) {
    const ids = list.filter(r => !r.received_at).map(r => r.id)
    if (!ids.length) return toast('Déjà réceptionné')
    const { error } = await supabase.from('return_labels').update({ received_at: new Date().toISOString(), received_by: user?.id || null }).in('id', ids)
    if (error) return toast.error(error.message)
    toast.success(`${ids.length} colis réceptionné(s)`); load()
  }
  async function scanReceive(e) {
    e.preventDefault()
    const code = scan.trim(); if (!code) return
    const r = rows.find(x => x.barcode === code)
    setScan('')
    if (!r) return toast.error(`Code ${code} introuvable pour cette date`)
    await receive([r])
  }
  const toggleOpen = k => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="page-title">Colis à retourner</h2>
            <p className="page-subtitle">Récupérés dans Urbantz chaque soir à 18h30 · étiquettes 10×15 cm historisées</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="date" className="form-input" value={day} onChange={e => setDay(e.target.value)} />
            <button className="btn btn-secondary" onClick={load}><RefreshCw size={14} /></button>
            <button className="btn btn-secondary" onClick={() => receive(rows.filter(r => sel.has(r.id)))}><CheckCircle size={14} /> Accuser réception ({sel.size})</button>
            <button className="btn btn-primary" onClick={() => print(rows.filter(r => sel.has(r.id)))}><Printer size={14} /> Imprimer la sélection ({sel.size})</button>
            <button className="btn btn-secondary" onClick={() => print(rows)}><Printer size={14} /> Tout imprimer</button>
          </div>
        </div>
      </div>
      <div className="page-body">
        <form onSubmit={scanReceive} style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <ScanLine size={18} />
          <input className="form-input" style={{ maxWidth: 320 }} placeholder="Scanner un code-barres pour accuser réception" value={scan} onChange={e => setScan(e.target.value)} />
          <span style={{ color: 'var(--gray-400)' }}>{rows.filter(r => r.received_at).length} / {rows.length} réceptionnés</span>
        </form>
        {loading ? <div className="loading-center"><div className="spinner dark" /></div> : rows.length === 0 ? (
          <div className="empty-state"><PackageX size={40} className="empty-state-icon" /><p className="empty-state-title">Aucun colis à retourner pour cette date</p></div>
        ) : groups.map(([name, list]) => {
          const isOpen = open.has(name), done = list.filter(r => r.received_at).length
          const allSel = list.every(r => sel.has(r.id))
          return (
          <div className="card" key={name} style={{ marginBottom: 12 }}>
            <div className="card-header" style={{ cursor: 'pointer' }} onClick={() => toggleOpen(name)}>
              <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}{name}</span>
              <span style={{ display: 'flex', gap: 8 }}>
                <span className={`badge ${done === list.length ? 'badge-green' : 'badge-orange'}`}>{done}/{list.length} réceptionnés</span>
                <span className="badge badge-purple">{list.length} colis</span>
              </span>
            </div>
            {isOpen && <div className="table-wrapper"><table>
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
                  <td>{r.received_at ? <span className="badge badge-green">{new Date(r.received_at).toLocaleString('fr-FR')}</span> : <button className="btn btn-secondary" onClick={() => receive([r])}>Accuser réception</button>}</td>
                  <td>{r.printed_at ? new Date(r.printed_at).toLocaleString('fr-FR') : '—'}</td>
                </tr>))}</tbody>
            </table>
            <div style={{ padding: 8, display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => receive(list)}><CheckCircle size={14} /> Tout réceptionner ({name})</button>
              <button className="btn btn-secondary" onClick={() => print(list.filter(r => sel.has(r.id)))}><Printer size={14} /> Imprimer les cochés</button>
            </div></div>}
          </div>)
        })}
      </div>
    </>
  )
}
