import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'

// Après le mot de passe, si le compte a la double authentification, le code à 6 chiffres est exigé avant tout accès
export default function MfaGate({ children }) {
  const { signOut, profile } = useAuth()
  const [state, setState] = useState('checking') // checking | ok | challenge | enroll
  const [enroll, setEnroll] = useState(null)
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [factorId, setFactorId] = useState(null)

  useEffect(() => { check() }, [])
  async function check() {
    try {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        const { data: f } = await supabase.auth.mfa.listFactors()
        const t = (f?.totp || []).find(x => x.status === 'verified')
        if (t) { setFactorId(t.id); setState('challenge'); return }
      }
      // 2FA exigée pour ce compte mais pas encore activée : activation obligatoire avant tout accès
      if (profile?.mfa_required) {
        const { data: f2 } = await supabase.auth.mfa.listFactors()
        if (!(f2?.totp || []).some(x => x.status === 'verified')) {
          // on repart d'une activation propre (facteur à moitié créé supprimé)
          for (const x of (f2?.totp || [])) await supabase.auth.mfa.unenroll({ factorId: x.id })
          const { data: en, error: ee } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Superflash ${new Date().toLocaleDateString('fr-FR')}` })
          if (ee) { setErr(ee.message); setState('enroll'); return }
          setEnroll({ id: en.id, qr: en.totp.qr_code, secret: en.totp.secret }); setState('enroll'); return
        }
      }
    } catch { /* en cas d'erreur de lecture, la connexion normale continue */ }
    setState('ok')
  }
  async function submitEnroll(e) {
    e.preventDefault(); setErr('')
    const { data: ch, error: ce } = await supabase.auth.mfa.challenge({ factorId: enroll.id })
    if (ce) return setErr(ce.message)
    const { error } = await supabase.auth.mfa.verify({ factorId: enroll.id, challengeId: ch.id, code: code.trim() })
    if (error) { setErr('Code incorrect, réessaie.'); setCode(''); return }
    setState('ok')
  }
  async function submit(e) {
    e.preventDefault(); setErr('')
    const { data: ch, error: ce } = await supabase.auth.mfa.challenge({ factorId })
    if (ce) return setErr(ce.message)
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: code.trim() })
    if (error) { setErr('Code incorrect, réessaie.'); setCode(''); return }
    setState('ok')
  }

  if (state === 'checking') return <div className="loading-center" style={{ height: '100vh' }}><div className="spinner dark" /></div>
  if (state === 'ok') return children
  if (state === 'enroll') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <form className="card" style={{ padding: 28, width: 400, maxWidth: '100%' }} onSubmit={submitEnroll}>
        <h2 style={{ marginBottom: 6 }}>Active la double authentification</h2>
        <p style={{ color: 'var(--gray-500)', fontSize: 14, marginBottom: 12 }}>Elle est exigée pour ton compte. 1. Scanne ce QR code avec une application d'authentification (Google Authenticator, Microsoft Authenticator…). 2. Saisis le code à 6 chiffres.</p>
        {enroll && <img src={enroll.qr} alt="QR code à scanner avec l'application d'authentification" width={180} height={180} style={{ background: '#fff', padding: 6, border: '1px solid var(--gray-200)', borderRadius: 8 }} />}
        {enroll && <p style={{ fontSize: 12, color: 'var(--gray-500)', margin: '8px 0' }}>Ou saisis cette clé : <code style={{ userSelect: 'all' }}>{enroll.secret}</code></p>}
        <input className="form-input" style={{ letterSpacing: 6, textAlign: 'center', fontSize: 20 }} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value)} aria-label="Code à 6 chiffres" disabled={!enroll} />
        {err && <div role="alert" style={{ color: 'var(--red, #b91c1c)', fontSize: 13, marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={!enroll}>Activer</button>
          <button type="button" className="btn btn-secondary" onClick={signOut}>Annuler</button>
        </div>
      </form>
    </div>
  )
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <form className="card" style={{ padding: 28, width: 360, maxWidth: '100%' }} onSubmit={submit}>
        <h2 style={{ marginBottom: 6 }}>Double authentification</h2>
        <p style={{ color: 'var(--gray-500)', fontSize: 14, marginBottom: 16 }}>Saisis le code à 6 chiffres de ton application d'authentification.</p>
        <input className="form-input" style={{ letterSpacing: 6, textAlign: 'center', fontSize: 20 }} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus value={code} onChange={e => setCode(e.target.value)} aria-label="Code à 6 chiffres" />
        {err && <div role="alert" style={{ color: 'var(--red, #b91c1c)', fontSize: 13, marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary" style={{ flex: 1 }}>Valider</button>
          <button type="button" className="btn btn-secondary" onClick={signOut}>Annuler</button>
        </div>
      </form>
    </div>
  )
}
