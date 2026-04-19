import { useState } from 'react'
import { useAuth } from './AuthContext'
import { Package, BarChart3, Users, CheckCircle } from 'lucide-react'

export default function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await signIn(email, password)
    if (error) {
      setError('Email ou mot de passe incorrect.')
      setLoading(false)
    }
  }

  return (
    <>
      <style>{`
        .login-wrapper {
          display: flex;
          min-height: 100vh;
        }
        .login-left {
          width: 320px;
          flex-shrink: 0;
          background: var(--navy);
          display: flex;
          flex-direction: column;
          padding: 40px 36px;
          position: relative;
          overflow: hidden;
        }
        .login-left::before {
          content: '';
          position: absolute;
          top: -100px; left: -100px;
          width: 300px; height: 300px;
          background: radial-gradient(circle, rgba(79,70,229,0.3) 0%, transparent 70%);
          pointer-events: none;
        }
        .login-right {
          flex: 1;
          background: var(--gray-bg);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 32px 16px;
          min-height: 100vh;
        }
        .login-mobile-logo {
          display: none;
          text-align: center;
          margin-bottom: 28px;
        }
        .login-mobile-logo .brand {
          font-family: var(--font-display);
          font-size: 22px;
          font-weight: 800;
          color: var(--navy);
          letter-spacing: -0.5px;
        }
        .login-mobile-logo .brand span {
          color: var(--accent);
        }
        .login-mobile-logo .sub {
          font-size: 11px;
          color: var(--gray-400);
          letter-spacing: 1px;
          text-transform: uppercase;
          margin-top: 2px;
        }
        @media (max-width: 700px) {
          .login-left { display: none !important; }
          .login-mobile-logo { display: block; }
          .login-right { justify-content: flex-start; padding-top: 48px; }
        }
        @media (max-width: 420px) {
          .login-card { padding: 28px 20px !important; }
        }
      `}</style>

      <div className="login-wrapper">

        {/* Panneau gauche */}
        <div className="login-left">
          <div style={{ marginBottom: 'auto' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 800, color: 'white', letterSpacing: '-0.3px' }}>
              CChezVous <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}>×</span> <span style={{ color: 'var(--accent)' }}>Doneo</span>
            </div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', letterSpacing: '1px', textTransform: 'uppercase', marginTop: '4px' }}>
              Contrôle des tournées
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', marginBottom: '48px' }}>
            <h2 style={{
              fontFamily: 'var(--font-display)', fontSize: '22px',
              fontWeight: 800, color: 'white', lineHeight: 1.2, marginBottom: '12px'
            }}>
              Gérez vos <span style={{ color: 'var(--accent)' }}>tournées</span> efficacement.
            </h2>
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.45)', lineHeight: 1.6, marginBottom: '24px' }}>
              Vérifiez les colis, détectez les anomalies et suivez les contrôles en temps réel.
            </p>

            {[
              { icon: <BarChart3 size={15} />, text: 'Dashboard & statistiques en direct' },
              { icon: <Package size={15} />, text: 'Scan et contrôle des colis par tournée' },
              { icon: <CheckCircle size={15} />, text: 'Détection automatique des anomalies' },
              { icon: <Users size={15} />, text: 'Gestion des opérateurs et historique' },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0' }}>
                <span style={{ color: 'var(--accent)', flexShrink: 0 }}>{item.icon}</span>
                <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.55)' }}>{item.text}</span>
              </div>
            ))}
          </div>

          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.2)' }}>
            © 2026 CChezVous × Doneo — Contrôle des tournées
          </p>
        </div>

        {/* Panneau droit */}
        <div className="login-right">

          {/* Logo mobile uniquement */}
          <div className="login-mobile-logo">
            <div className="brand">CChezVous <span style={{ color: 'rgba(0,0,0,0.2)', fontWeight: 400 }}>×</span> <span>Doneo</span></div>
            <div className="sub">Contrôle des tournées</div>
          </div>

          <div className="card login-card" style={{ width: '100%', maxWidth: '420px', padding: '36px 32px' }}>
            <h3 style={{
              fontFamily: 'var(--font-display)', fontSize: '22px',
              fontWeight: 700, color: 'var(--gray-800)', marginBottom: '6px'
            }}>
              Connexion
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--gray-400)', marginBottom: '28px' }}>
              Accédez à votre espace de travail
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Adresse email</label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="vous@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Mot de passe</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>

              {error && (
                <div style={{
                  background: 'var(--red-light)', color: '#991b1b',
                  padding: '10px 14px', borderRadius: 'var(--radius-sm)', fontSize: '13px',
                }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary btn-lg w-full"
                disabled={loading}
                style={{ justifyContent: 'center', marginTop: '4px' }}
              >
                {loading ? <div className="spinner" /> : '→ Se connecter'}
              </button>
            </form>

            <p style={{ fontSize: '12px', color: 'var(--gray-400)', textAlign: 'center', marginTop: '20px' }}>
              Accès réservé aux utilisateurs <strong style={{ color: 'var(--accent)' }}>autorisés</strong>
            </p>
          </div>

          <p style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '24px', textAlign: 'center' }}>
            © 2026 CChezVous × Doneo
          </p>
        </div>

      </div>
    </>
  )
}
