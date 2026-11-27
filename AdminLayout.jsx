import { Fragment, useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { useDemandeNotifications } from './demandeNotifications'
import { useUnrecognizedRounds } from './unrecognizedRounds'
import {
  LayoutDashboard, Truck, Upload, Users, Search, FileSearch, RotateCcw, LogOut, Menu, X, BookMarked, ClipboardList, Map, Activity, ShieldAlert, MailIcon, PackageX, ClipboardCheck, MessageSquarePlus, AlertTriangle, ListChecks, LayoutGrid, Bell
} from 'lucide-react'

// Menu regroupé par section (le Dashboard est seul, en haut)
const navSections = [
  {
    label: null,
    items: [
      { to: '/admin', label: 'Dashboard - Logistique', icon: <LayoutDashboard size={16} />, end: true },
      { to: '/admin/dashboard-transport', label: 'Dashboard - Transport', icon: <Truck size={16} /> },
      { to: '/admin/notifications', label: 'Notifications', icon: <Bell size={16} /> },
    ],
  },
  {
    label: 'Traitement des demandes et défaillances',
    items: [
      { to: '/admin/demandes', label: 'Demandes', icon: <MessageSquarePlus size={16} /> },
      { to: '/admin/defaillances', label: 'Défaillances', icon: <AlertTriangle size={16} /> },
    ],
  },
  {
    label: 'Préparation',
    items: [
      { to: '/admin/upload', label: 'Importer un PDF', icon: <Upload size={16} /> },
      { to: '/admin/preparation-tournees', label: 'Préparation des tournées', icon: <ClipboardList size={16} /> },
      { to: '/admin/plan-chargement', label: 'Plan de chargement', icon: <LayoutGrid size={16} /> },
      { to: '/admin/groupages', label: 'Groupages', icon: <Truck size={16} /> },
      { to: '/admin/warehouse', label: 'Plan entrepôt', icon: <Map size={16} /> },
      { to: '/admin/anomalies-preparation', label: 'Anomalies préparation', icon: <PackageX size={16} /> },
      { to: '/admin/reprises', label: 'Reprises', icon: <RotateCcw size={16} /> },
    ],
  },
  {
    label: 'Contrôle',
    items: [
      { to: '/admin/checklist', label: 'Checklist', icon: <ListChecks size={16} /> },
      { to: '/admin/tours', label: 'Tournées', icon: <Truck size={16} /> },
      { to: '/admin/suivi-tournees', label: 'Suivi des tournées', icon: <Activity size={16} /> },
      { to: '/admin/colis-non-rapatries', label: 'Colis non rapatriés', icon: <PackageX size={16} /> },
      { to: '/admin/inventaire', label: 'Inventaire', icon: <ClipboardCheck size={16} /> },
      { to: '/admin/anomalies-reception', label: 'Anomalies réception', icon: <ShieldAlert size={16} /> },
      { to: '/admin/search-tours', label: 'Recherche tournées', icon: <FileSearch size={16} /> },
      { to: '/admin/search-parcel', label: 'Recherche colis', icon: <Search size={16} /> },
    ],
  },
  {
    label: 'Administratif',
    items: [
      { to: '/admin/email-recipients', label: 'Gestion mailing', icon: <MailIcon size={16} /> },
      { to: '/admin/users', label: 'Utilisateurs', icon: <Users size={16} /> },
      { to: '/admin/reference-tours', label: 'Tournées de référence', icon: <BookMarked size={16} /> },
    ],
  },
]

export default function AdminLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const notifs = useDemandeNotifications({ toastOnNew: true })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const unrecognized = useUnrecognizedRounds()

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  function closeSidebar() { setSidebarOpen(false) }

  return (
    <div className="app-layout">
      <div
        className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`}
        onClick={closeSidebar}
      />

      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-logo">
          <div>
            <h1>Superflash</h1>
            <p style={{ fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Meilleure plateforme de France pour une bonne raison</p>
          </div>
          <button className="sidebar-close" onClick={closeSidebar}>
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {navSections.map((section, i) => (
            <Fragment key={section.label || 'top'}>
              {section.label && (
                <span className="sidebar-section-label" style={{ marginTop: i > 1 ? '8px' : undefined }}>{section.label}</span>
              )}
              {section.items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                  onClick={closeSidebar}
                >
                  {item.icon}
                  {item.label}
                  {item.to === '/admin/reference-tours' && unrecognized.length > 0 && (
                    <span title="Tournées Urbantz non reconnues" style={{ marginLeft: 'auto', background: '#ef4444', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '1px 7px', minWidth: 18, textAlign: 'center' }}>{unrecognized.length}</span>
                  )}
                  {(item.to === '/admin/demandes' || item.to === '/admin/notifications') && notifs.total > 0 && (
                    <span title="Réponses non lues" style={{ marginLeft: 'auto', background: '#ef4444', color: '#fff', borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '1px 7px', minWidth: 18, textAlign: 'center' }}>{notifs.total}</span>
                  )}
                </NavLink>
              ))}
            </Fragment>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">{initials}</div>
            <div className="user-info" role="link" tabIndex={0} title="Mon compte (mot de passe, double authentification)" style={{ cursor: 'pointer' }} onClick={() => navigate('/admin/compte')} onKeyDown={e => { if (e.key === 'Enter') navigate('/admin/compte') }}>
              <div className="user-name">{profile?.full_name || profile?.email}</div>
              <div className="user-role">Administrateur</div>
            </div>
            <button className="btn-logout" onClick={handleSignOut} title="Déconnexion">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <div className="mobile-topbar">
          <button className="btn-menu" onClick={() => setSidebarOpen(true)}>
            <Menu size={22} />
          </button>
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
