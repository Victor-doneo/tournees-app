import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Truck, Camera, Plus } from 'lucide-react'

const BUCKET = 'cmr-photos'
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const fr = d => d.split('-').reverse().join('/')
const hhmm = t => (t ? String(t).slice(0, 5) : '')

// Réduit la photo (≈1600 px) avant envoi : les photos de téléphone font plusieurs Mo
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.82))
    return blob || file
  } catch { return file }
}

export default function Groupages() {
  const [from, setFrom] = useState(addDays(today(), -7))
  const [to, setTo] = useState(addDays(today(), 7))
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [urls, setUrls] = useState({})
  const [adding, setAdding] = useState(false)
  const [nw, setNw] = useState({ groupage: '', transporteur: '', date_chargement: today() })

  async function load() {
    setLoading(true); setError('')
    const { data, error: e } = await supabase.from('groupages').select('*').gte('date_chargement', from).lte('date_chargement', to)
      .order('date_chargement', { ascending: false }).order('groupage')
    if (e) setError(`${e.message} (migration supabase_migration_groupages.sql lancée ?)`)
    setRows(data || []); setLoading(false)
    const paths = (data || []).map(r => r.cmr_photo_path).filter(Boolean)
    if (paths.length) {
      const { data: s } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
      setUrls(Object.fromEntries((s || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl])))
    } else setUrls({})
  }
  useEffect(() => { load() }, [from, to]) // eslint-disable-line

  async function patch(id, fields) {
    const { error: e } = await supabase.from('groupages').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id)
    if (e) { setError(e.message); return false }
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...fields } : r)); return true
  }
  async function upload(r, file) {
    if (!file) return
    setBusy(r.id); setError('')
    const blob = await shrink(file)
    const path = `${r.date_chargement}/${r.numero_reception}-${Date.now()}.jpg`
    const { error: e } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
    if (e) { setError(`Photo non envoyée : ${e.message}`); setBusy(''); return }
    if (await patch(r.id, { cmr_photo_path: path })) {
      const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
      if (s?.signedUrl) setUrls(u => ({ ...u, [path]: s.signedUrl }))
    }
    setBusy('')
  }
  async function add(e) {
    e.preventDefault()
    const g = nw.groupage.replace(/\D/g, '')
    if (!g || !nw.date_chargement) return
    const { error: er } = await supabase.from('groupages').insert({ groupage: g, transporteur: nw.transporteur.trim() || null, date_chargement: nw.date_chargement, source: 'manuel' })
    if (er) { setError(er.code === '23505' ? 'Ce groupage existe déjà à cette date' : er.message); return }
    setNw({ groupage: '', transporteur: '', date_chargement: nw.date_chargement }); setAdding(false); load()
  }

  return (
    <>
      <div className="page-header">
        <div className="flex items-center justify-between" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div><h2 className="page-title">Groupages</h2><p className="page-subtitle">Groupages reçus par mail chaque jour : heure de présentation du camion, fin de déchargement et photo de la CMR</p></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13 }}>Du <input type="date" className="form-input" style={{ width: 'auto', display: 'inline-block' }} value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} /></label>
            <label style={{ fontSize: 13 }}>au <input type="date" className="form-input" style={{ width: 'auto', display: 'inline-block' }} value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} /></label>
            <button type="button" className="btn btn-secondary" onClick={() => setAdding(a => !a)}><Plus size={14} /> Ajouter</button>
          </div>
        </div>
      </div>
      <div className="page-body">
        {error && <div className="card" style={{ padding: 12, color: 'var(--red, #b91c1c)', marginBottom: 12 }}>{error}</div>}
        {adding && (
          <form onSubmit={add} className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="form-input" style={{ width: 140 }} placeholder="N° groupage" value={nw.groupage} onChange={e => setNw({ ...nw, groupage: e.target.value })} required />
            <input className="form-input" style={{ width: 200 }} placeholder="Transporteur" value={nw.transporteur} onChange={e => setNw({ ...nw, transporteur: e.target.value })} />
            <input type="date" className="form-input" style={{ width: 'auto' }} value={nw.date_chargement} onChange={e => setNw({ ...nw, date_chargement: e.target.value })} required />
            <button className="btn btn-primary" type="submit">Enregistrer</button>
          </form>
        )}
        {loading ? <div className="card" style={{ padding: 24, textAlign: 'center' }}>Chargement…</div>
          : !rows.length ? <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--gray-400)' }}>Aucun groupage sur la période</div>
          : (
            <div className="table-wrapper"><table>
              <thead><tr><th>Chargement</th><th>Groupage</th><th>N° réception</th><th>Transporteur</th><th>Poids</th><th>Présentation camion</th><th>Fin déchargement</th><th>CMR</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td>{fr(r.date_chargement)}</td>
                    <td><b>{r.groupage}</b></td>
                    <td style={{ fontFamily: 'monospace' }}>{r.numero_reception}</td>
                    <td>{r.transporteur || '—'}</td>
                    <td>{r.poids != null ? String(r.poids).replace('.', ',') : '—'}</td>
                    <td><input type="time" className="form-input" style={{ width: 'auto' }} defaultValue={hhmm(r.heure_presentation)} onBlur={e => { if (e.target.value !== hhmm(r.heure_presentation)) patch(r.id, { heure_presentation: e.target.value || null }) }} /></td>
                    <td><input type="time" className="form-input" style={{ width: 'auto' }} defaultValue={hhmm(r.fin_dechargement)} onBlur={e => { if (e.target.value !== hhmm(r.fin_dechargement)) patch(r.id, { fin_dechargement: e.target.value || null }) }} /></td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {r.cmr_photo_path && urls[r.cmr_photo_path] && <a href={urls[r.cmr_photo_path]} target="_blank" rel="noreferrer" title="Voir la CMR"><img src={urls[r.cmr_photo_path]} alt="CMR" style={{ height: 38, borderRadius: 4, border: '1px solid var(--gray-200, #e5e7eb)' }} /></a>}
                        <label className="btn btn-secondary" style={{ cursor: 'pointer', fontSize: 12, padding: '4px 10px' }}>
                          {busy === r.id ? 'Envoi…' : <><Camera size={13} /> {r.cmr_photo_path ? 'Remplacer' : 'Photo'}</>}
                          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} disabled={busy === r.id} onChange={e => { upload(r, e.target.files?.[0]); e.target.value = '' }} />
                        </label>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
      </div>
    </>
  )
}
