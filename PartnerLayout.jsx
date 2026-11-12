import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { LogOut, ClipboardList, AlertTriangle, LayoutGrid, Mail, Activity } from 'lucide-react'

export default function PartnerLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="app-layout">
      <aside className="sidebar" style={{ position: 'static' }}>
        <div className="sidebar-logo">
          <div>
            <h1>Superflash</h1>
            <p style={{ fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Meilleure plateforme de France pour une bonne raison</p>
            <p>Accès partenaire</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          <span className="sidebar-section-label">Suivi</span>
          <NavLink to="/partner" end className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <ClipboardList size={16} />
            Suivi des tâches
          </NavLink>
          <NavLink to="/partner/defaillances" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <AlertTriangle size={16} />
            Défaillances
          </NavLink>
          {profile?.can_view_tour_tracking && (
            <NavLink to="/partner/suivi-tournees" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <Activity size={16} />
              Suivi des tournées
            </NavLink>
          )}
          {profile?.can_manage_loading_plan && (
            <>
              <span className="sidebar-section-label">Plan de chargement</span>
              <NavLink to="/partner/plan-chargement" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <LayoutGrid size={16} />
                Plan de chargement
              </NavLink>
              <NavLink to="/partner/destinataires-plan" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <Mail size={16} />
                Gestion mailing
              </NavLink>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">{initials}</div>
            <div className="user-info">
              <div className="user-name">{profile?.full_name || profile?.email}</div>
              <div className="user-role">Partenaire</div>
            </div>
            <button className="btn-logout" onClick={handleSignOut} title="Déconnexion">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <div className="mobile-topbar">
          <span className="mobile-topbar-logo">Superflash</span>
          <div className="user-avatar" style={{ width: 32, height: 32, fontSize: 11 }}>
            {initials}
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  )
}
