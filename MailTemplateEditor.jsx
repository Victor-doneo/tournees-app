import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import toast from 'react-hot-toast'
import { DEFAULT_TEMPLATE, renderSubject, renderBody } from './mailTemplate'
import { useAuth } from './AuthContext'

const SAMPLE_TABLE = `<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt"><tr><th style="border:1px solid #999;padding:4px 8px;background:#eee"></th><th style="border:1px solid #999;padding:4px 8px;background:#eee">QUAI 3</th><th style="border:1px solid #999;padding:4px 8px;background:#eee">QUAI 6</th></tr><tr><td style="border:1px solid #999;padding:4px 8px">05:30</td><td style="border:1px solid #999;padding:4px 8px">TGP9</td><td style="border:1px solid #999;padding:4px 8px">TKN1</td></tr></table>`

export default function MailTemplateEditor() {
  const { profile } = useAuth()
  const [t, setT] = useState(DEFAULT_TEMPLATE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const sampleDate = new Date(Date.now() + 86400000).toLocaleDateString('en-CA')

  useEffect(() => {
    supabase.from('loading_plan_mail_template').select('subject, greeting, intro, signature').eq('id', 1).maybeSingle()
      .then(({ data, error }) => {
        if (error) toast.error('Erreur : ' + error.message)
        else if (data) setT(data)
        setLoading(false)
      })
  }, [])

  async function save() {
    if (!t.subject.trim()) return toast.error("L'objet ne peut pas être vide.")
    setSaving(true)
    const { error } = await supabase.from('loading_plan_mail_template')
      .upsert({ id: 1, ...t, updated_at: new Date().toISOString(), updated_by: profile?.id })
    setSaving(false)
    if (error) toast.error('Erreur : ' + error.message)
    else toast.success('Modèle enregistré')
  }

  const set = k => e => setT(p => ({ ...p, [k]: e.target.value }))
  const lbl = { fontSize: 13, fontWeight: 600, color: 'var(--gray-700)', marginBottom: 4, display: 'block' }

  if (loading) return <div className="loading-center" style={{ padding: 32 }}><div className="spinner dark" /></div>

  return (
    <div className="page-body" style={{ maxWidth: 760 }}>
      <div className="card" style={{ marginBottom: 20, overflow: 'hidden' }}>
        <div className="card-header"><span className="card-title">Modèle du mail</span></div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={lbl}>Objet</label>
            <input className="form-input" value={t.subject} onChange={set('subject')} />
          </div>
          <div>
            <label style={lbl}>Formule d'appel</label>
            <textarea className="form-input" rows={2} value={t.greeting} onChange={set('greeting')} />
          </div>
          <div>
            <label style={lbl}>Texte avant le tableau</label>
            <textarea className="form-input" rows={3} value={t.intro} onChange={set('intro')} />
          </div>
          <div>
            <label style={lbl}>Signature (après le tableau)</label>
            <textarea className="form-input" rows={3} value={t.signature} onChange={set('signature')} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--gray-400)', margin: 0 }}>
            Variables : <code>{'{date}'}</code> = JJ.MM.AAAA, <code>{'{date_longue}'}</code> = LUNDI 10 NOVEMBRE 2026 (mise en gras dans le corps du mail). Le tableau créneaux × quais est inséré automatiquement entre le texte et la signature.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
            <button className="btn btn-secondary" onClick={() => setT(DEFAULT_TEMPLATE)}>Remettre le modèle par défaut</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-header"><span className="card-title">Aperçu</span></div>
        <div className="card-body">
          <div style={{ fontSize: 13, marginBottom: 10 }}><b>Objet :</b> {renderSubject(t, sampleDate)}</div>
          <div style={{ border: '1px solid var(--gray-200)', borderRadius: 6, padding: 12 }} dangerouslySetInnerHTML={{ __html: renderBody(t, sampleDate, SAMPLE_TABLE) }} />
        </div>
      </div>
    </div>
  )
}
