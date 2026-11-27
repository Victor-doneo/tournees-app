import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import toast from 'react-hot-toast'
import { ShieldCheck, KeyRound } from 'lucide-react'

// « Mon compte » : changement de mot de passe en autonomie + double authentification (application d'authentification, TOTP)
export default function AccountSettings() {
  const { profile, user } = useAuth()
  const [cur, setCur] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [factors, setFactors] = useState([])
  const [enroll, setEnroll] = useState(null) // { id, qr, secret }
  const [code, setCode] = useState('')

  useEffect(() => { loadFactors() }, [])
  async function loadFactors() {
    const { data } = await supabase.auth.mfa.listFactors()
    setFactors((data?.totp || []).filter(f => f.status === 'verified'))
  }

  async function changePassword(e) {
    e.preventDefault()
    if (pw.length < 8) return toast.error('Le nouveau mot de passe doit faire 8 caractères minimum')
    if (pw !== pw2) return toast.error('Les deux mots de passe ne correspondent pas')
    setBusy(true)
    try {
      // On vérifie l'ancien mot de passe avant d'accepter le nouveau
      const { error: ve } = await supabase.auth.signInWithPassword({ email: user.email, password: cur })
      if (ve) throw new Error('Mot de passe actuel incorrect')
      const { error } = await supabase.auth.updateUser({ password: pw })
      if (error) throw error
      toast.success('Mot de passe modifié')
      setCur(''); setPw(''); setPw2('')
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }

  async function startEnroll() {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Superflash ${new Date().toLocaleDateString('fr-FR')}` })
    if (error) return toast.error(error.message + ' (la double authentification est-elle activée dans Supabase > Authentication > Multi-Factor ?)')
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret }); setCode('')
  }
  async function confirmEnroll(e) {
    e.preventDefault()
    const { data: ch, error: ce } = await supabase.auth.mfa.challenge({ factorId: enroll.id })
    if (ce) return toast.error(ce.message)
    const { error } = await supabase.auth.mfa.verify({ factorId: enroll.id, challengeId: ch.id, code: code.trim() })
    if (error) return toast.error('Code incorrect : ' + error.message)
    toast.success('Double authentification activée')
    setEnroll(null); loadFactors()
  }
  async function cancelEnroll() { if (enroll) await supabase.auth.mfa.unenroll({ factorId: enroll.id }); setEnroll(null) }
  async function disable(f) {
    if (!window.confirm('Désactiver la double authentification de ce compte ?')) return
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id })
    if (error) return toast.error(error.message)
    toast.success('Double authentification désactivée'); loadFactors()
  }

  return (
    <>
      <div className="page-header"><div><h2 className="page-title">Mon compte</h2><p className="page-subtitle">{profile?.full_name || user?.email} · {user?.email}</p></div></div>
      <div className="page-body" style={{ display: 'grid', gap: 16, maxWidth: 560 }}>
        <form className="card" style={{ padding: 20 }} onSubmit={changePassword}>
          <h3 style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}><KeyRound size={16} /> Changer mon mot de passe</h3>
          <div className="form-group"><label className="form-label" htmlFor="cur">Mot de passe actuel</label><input id="cur" className="form-input" type="password" required autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} /></div>
          <div className="form-group"><label className="form-label" htmlFor="pw">Nouveau mot de passe</label><input id="pw" className="form-input" type="password" required minLength={8} autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} placeholder="8 caractères minimum" /></div>
          <div className="form-group"><label className="form-label" htmlFor="pw2">Confirmer le nouveau mot de passe</label><input id="pw2" className="form-input" type="password" required minLength={8} autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} /></div>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Modification…' : 'Modifier le mot de passe'}</button>
        </form>

        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}><ShieldCheck size={16} /> Double authentification</h3>
          <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 12 }}>Un code à 6 chiffres, généré par une application (Google Authenticator, Microsoft Authenticator, 1Password…), est demandé à chaque connexion.</p>
          {factors.length > 0 && !enroll && (
            <div>
              <div style={{ marginBottom: 10 }}><span className="badge badge-green">Activée</span></div>
              {factors.map(f => (
                <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--gray-100, #f3f4f6)' }}>
                  <span style={{ fontSize: 13 }}>{f.friendly_name || 'Application d\'authentification'} · ajoutée le {new Date(f.created_at).toLocaleDateString('fr-FR')}</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => disable(f)}>Désactiver</button>
                </div>
              ))}
            </div>
          )}
          {factors.length === 0 && !enroll && <button className="btn btn-primary" onClick={startEnroll}>Activer la double authentification</button>}
          {enroll && (
            <form onSubmit={confirmEnroll}>
              <p style={{ fontSize: 13, marginBottom: 8 }}>1. Scanne ce QR code avec ton application d'authentification.</p>
              <img src={enroll.qr} alt="QR code à scanner avec l'application d'authentification" width={180} height={180} style={{ background: '#fff', padding: 6, border: '1px solid var(--gray-200)', borderRadius: 8 }} />
              <p style={{ fontSize: 12, color: 'var(--gray-500)', margin: '8px 0' }}>Ou saisis cette clé : <code style={{ userSelect: 'all' }}>{enroll.secret}</code></p>
              <p style={{ fontSize: 13, marginBottom: 6 }}>2. Saisis le code à 6 chiffres affiché.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="form-input" style={{ width: 160, letterSpacing: 4, textAlign: 'center' }} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus value={code} onChange={e => setCode(e.target.value)} aria-label="Code à 6 chiffres" />
                <button className="btn btn-primary">Valider</button>
                <button type="button" className="btn btn-secondary" onClick={cancelEnroll}>Annuler</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  )
}
