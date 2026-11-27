import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { useDemandeNotifications } from './demandeNotifications'
import { LogOut, ClipboardList, AlertTriangle, LayoutGrid, Mail, Activity, Search, Bell, BarChart3, PackageX, Users } from 'lucide-react'

export default function PartnerLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const notifs = useDemandeNotifications({ toastOnNew: true })

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
          {profile?.can_view_tour_tracking && (
            <NavLink to="/partner/dashboard-transport" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <BarChart3 size={16} />
              Dashboard - Transport
            </NavLink>
          )}
          <NavLink to="/partner/notifications" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <Bell size={16} />
            Notifications
            {notifs.total > 0 && (
              <span title="Réponses non lues" style={{ marginLeft: 'auto', background: '#ef4444', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '1px 7px', minWidth: 18, textAlign: 'center' }}>{notifs.total}</span>
            )}
          </NavLink>
          <span className="sidebar-section-label">Traitement des demandes et défaillances</span>
          <NavLink to="/partner" end className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <ClipboardList size={16} />
            Suivi des tâches
            {notifs.total > 0 && (
              <span title="Réponses non lues" style={{ marginLeft: 'auto', background: '#ef4444', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '1px 7px', minWidth: 18, textAlign: 'center' }}>{notifs.total}</span>
            )}
          </NavLink>
          <NavLink to="/partner/defaillances" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <AlertTriangle size={16} />
            Défaillances
          </NavLink>
          {profile?.can_manage_loading_plan && (
            <>
              <span className="sidebar-section-label" style={{ marginTop: 8 }}>Préparation</span>
              <NavLink to="/partner/plan-chargement" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <LayoutGrid size={16} />
                Plan de chargement
              </NavLink>
            </>
          )}
          <span className="sidebar-section-label" style={{ marginTop: 8 }}>Contrôle</span>
          {profile?.can_view_tour_tracking && (
            <NavLink to="/partner/suivi-tournees" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <Activity size={16} />
              Suivi des tournées
            </NavLink>
          )}
          {profile?.can_view_tour_tracking && (
            <NavLink to="/partner/colis-non-rapatries" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <PackageX size={16} />
              Colis non rapatriés
            </NavLink>
          )}
          <NavLink to="/partner/search-parcel" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <Search size={16} />
            Recherche BP
          </NavLink>
          {profile?.can_manage_carriers && (
            <>
              <span className="sidebar-section-label" style={{ marginTop: 8 }}>Administratif</span>
              <NavLink to="/partner/comptes-transporteurs" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <Users size={16} />
                Comptes transporteurs
              </NavLink>
            </>
          )}
          {profile?.can_manage_loading_plan && (
            <>
              {!profile?.can_manage_carriers && <span className="sidebar-section-label" style={{ marginTop: 8 }}>Administratif</span>}
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
            <div className="user-info" role="link" tabIndex={0} title="Mon compte (mot de passe, double authentification)" style={{ cursor: 'pointer' }} onClick={() => navigate('/partner/compte')} onKeyDown={e => { if (e.key === 'Enter') navigate('/partner/compte') }}>
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
