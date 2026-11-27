import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { LogOut, BarChart3, PackageX } from 'lucide-react'

// Espace transporteur : uniquement sa qualité et ses colis non rapatriés (les données sont filtrées côté base par fournisseur)
export default function CarrierLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const initials = profile?.full_name ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : '?'
  const cls = ({ isActive }) => `nav-item${isActive ? ' active' : ''}`
  async function handleSignOut() { await signOut(); navigate('/login') }
  return (
    <div className="app-layout">
      <aside className="sidebar" style={{ position: 'static' }}>
        <div className="sidebar-logo">
          <div>
            <h1>Superflash</h1>
            <p>Espace transporteur{(profile?.suppliers || []).length ? ` · ${profile.suppliers.join(', ')}` : ''}</p>
          </div>
        </div>
        <nav className="sidebar-nav">
          <NavLink to="/carrier" end className={cls}><BarChart3 size={16} />Ma qualité</NavLink>
          <NavLink to="/carrier/colis-non-rapatries" className={cls}><PackageX size={16} />Mes colis non rapatriés</NavLink>
        </nav>
        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">{initials}</div>
            <div className="user-info" role="link" tabIndex={0} title="Mon compte (mot de passe, double authentification)" style={{ cursor: 'pointer' }} onClick={() => navigate('/carrier/compte')} onKeyDown={e => { if (e.key === 'Enter') navigate('/carrier/compte') }}>
              <div className="user-name">{profile?.full_name || profile?.email}</div>
              <div className="user-role">Transporteur</div>
            </div>
            <button className="btn-logout" onClick={handleSignOut} title="Déconnexion" aria-label="Déconnexion"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>
      <main className="main-content">
        <div className="mobile-topbar">
          <span className="mobile-topbar-logo">Superflash</span>
          <div className="user-avatar" style={{ width: 32, height: 32, fontSize: 11 }}>{initials}</div>
        </div>
        <Outlet />
      </main>
    </div>
  )
}
