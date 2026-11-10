import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Plus, Trash2, Mail, ToggleLeft, ToggleRight } from 'lucide-react'
import toast from 'react-hot-toast'
import MailTemplateEditor from './MailTemplateEditor'

const TABS = {
  rapport: { table: 'email_recipients', title: 'Rapport journalier', sub: 'Gérez les destinataires du rapport journalier automatique', hint: 'Le rapport est envoyé automatiquement chaque jour à 23h59.' },
  plan: { table: 'loading_plan_recipients', title: 'Plan de chargement', sub: 'Destinataires du mail PLAN DE CHARGEMENT/ CCV / ANTONY / JJ.MM.AAAA (envoi depuis la page « Plan de chargement »)', hint: 'Un mail par journée, envoyé manuellement via le bouton « Envoyer par mail ».' },
  modele: { table: null, title: 'Modèle du mail du plan', sub: "Objet, texte d'introduction et signature du mail du plan de chargement", hint: '' },
}

export default function EmailRecipients({ only }) {
  const [tab, setTab] = useState(only || 'rapport')
  const T = TABS[tab]
  const [recipients, setRecipients] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ email: '', full_name: '' })
  const [adding, setAdding] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => { if (T.table) fetchRecipients() }, [tab])

  async function fetchRecipients() {
    setLoading(true)
    const { data } = await supabase
      .from(T.table)
      .select('*')
      .order('created_at')
    setRecipients(data || [])
    setLoading(false)
  }

  async function handleAdd() {
    if (!form.email.trim()) return toast.error('Saisissez un email.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return toast.error('Email invalide.')
    setAdding(true)
    const { error } = await supabase.from(T.table).insert({
      email: form.email.trim().toLowerCase(),
      full_name: form.full_name.trim() || null,
    })
    if (error) {
      toast.error(error.code === '23505' ? 'Cet email existe déjà.' : 'Erreur lors de l\'ajout.')
    } else {
      toast.success('Destinataire ajouté.')
      setForm({ email: '', full_name: '' })
      fetchRecipients()
    }
    setAdding(false)
  }

  async function toggleActive(r) {
    const { error } = await supabase
      .from(T.table)
      .update({ active: !r.active })
      .eq('id', r.id)
    if (error) toast.error('Erreur')
    else setRecipients(prev => prev.map(x => x.id === r.id ? { ...x, active: !x.active } : x))
  }

  async function handleDelete(id, email) {
    if (!confirm(`Supprimer ${email} ?`)) return
    const { error } = await supabase.from(T.table).delete().eq('id', id)
    if (error) toast.error('Erreur lors de la suppression.')
    else { toast.success('Destinataire supprimé.'); fetchRecipients() }
  }

  async function testEmail() {
    setTesting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-daily-report`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      const result = await response.json()
      if (response.ok) toast.success(`Email envoyé à ${result.sent_to} destinataire(s) !`)
      else toast.error('Erreur : ' + (result.error || 'Inconnue'))
    } catch (err) {
      toast.error('Erreur : ' + err.message)
    }
    setTesting(false)
  }

  const activeCount = recipients.filter(r => r.active).length

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2 className="page-title">Destinataires</h2>
            <p className="page-subtitle">{T.sub}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {Object.entries(TABS).filter(([k]) => !only || k === 'plan' || k === 'modele').map(([k, v]) => (
                <button key={k} className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(k)}>{v.title}</button>
              ))}
            </div>
          </div>
          {tab === 'rapport' && <button
            className="btn btn-secondary btn-sm"
            onClick={testEmail}
            disabled={testing || activeCount === 0}
            style={{ paddingTop: 4 }}
          >
            {testing ? <><div className="spinner" /> Envoi...</> : <><Mail size={14} /> Tester l'envoi</>}
          </button>}
        </div>
      </div>

      {tab === 'modele' ? <MailTemplateEditor /> : <div className="page-body" style={{ maxWidth: 560 }}>

        {/* Formulaire ajout */}
        <div className="card" style={{ marginBottom: 20, overflow: 'hidden' }}>
          <div className="card-header">
            <span className="card-title">Ajouter un destinataire</span>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input
                className="form-input"
                placeholder="Email *"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                style={{ flex: 1, minWidth: 160 }}
              />
              <input
                className="form-input"
                placeholder="Nom (optionnel)"
                value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                style={{ flex: 1, minWidth: 160 }}
              />
              <button
                className="btn btn-primary"
                onClick={handleAdd}
                disabled={adding || !form.email.trim()}
              >
                <Plus size={15} /> Ajouter
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--gray-400)', margin: 0 }}>
              {T.hint}
            </p>
          </div>
        </div>

        {/* Liste */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-title">Destinataires</span>
            <span className="badge badge-gray">{activeCount} actif{activeCount > 1 ? 's' : ''} / {recipients.length}</span>
          </div>

          {loading ? (
            <div className="loading-center" style={{ padding: 32 }}>
              <div className="spinner dark" />
            </div>
          ) : recipients.length === 0 ? (
            <div className="empty-state" style={{ padding: 32 }}>
              <Mail size={32} className="empty-state-icon" />
              <p className="empty-state-title">Aucun destinataire</p>
              <p className="empty-state-sub">Ajoutez des destinataires ci-dessus.</p>
            </div>
          ) : (
            recipients.map(r => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 16px', borderBottom: '1px solid var(--gray-100)',
                opacity: r.active ? 1 : 0.5,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--gray-800)' }}>{r.email}</div>
                  {r.full_name && <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{r.full_name}</div>}
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => toggleActive(r)}
                  title={r.active ? 'Désactiver' : 'Activer'}
                  style={{ color: r.active ? 'var(--green)' : 'var(--gray-400)' }}
                >
                  {r.active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleDelete(r.id, r.email)}
                  style={{ color: 'var(--red)' }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>}
    </>
  )
}
