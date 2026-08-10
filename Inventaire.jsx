import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import {
  LayoutDashboard, Truck, Upload, Users, Search, FileSearch, RotateCcw, LogOut, Menu, X, BookMarked, ClipboardList, Map, Activity, ShieldAlert, MailIcon, PackageX, ClipboardCheck
} from 'lucide-react'

const navPilotage = [
  { to: '/admin', label: 'Dashboard', icon: <LayoutDashboard size={16} />, end: true },
  { to: '/admin/preparation-tournees', label: 'Préparation des tournées', icon: <ClipboardList size={16} /> },
  { to: '/admin/warehouse', label: 'Plan entrepôt', icon: <Map size={16} /> },
  { to: '/admin/suivi-tournees', label: 'Suivi des tournées', icon: <Activity size={16} /> },
  { to: '/admin/anomalies-reception', label: 'Anomalies réception', icon: <ShieldAlert size={16} /> },
  { to: '/admin/anomalies-preparation', label: 'Anomalies préparation', icon: <PackageX size={16} /> },
  { to: '/admin/reprises', label: 'Reprises', icon: <RotateCcw size={16} /> },
]

const navControle = [
  { to: '/admin/inventaire', label: 'Inventaire', icon: <ClipboardCheck size={16} /> },
  { to: '/admin/tours', label: 'Tournées', icon: <Truck size={16} /> },
  { to: '/admin/search-tours', label: 'Recherche tournées', icon: <FileSearch size={16} /> },
  { to: '/admin/search-parcel', label: 'Recherche colis', icon: <Search size={16} /> },
]

const navAdmin = [
  { to: '/admin/upload', label: 'Importer un PDF', icon: <Upload size={16} /> },
  { to: '/admin/email-recipients', label: 'Destinataires rapport', icon: <MailIcon size={16} /> },
  { to: '/admin/users', label: 'Utilisateurs', icon: <Users size={16} /> },
  { to: '/admin/reference-tours', label: 'Tournées de référence', icon: <BookMarked size={16} /> },
]

export default function AdminLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
            <p>Un outil DONEO pour être meilleur que le Blanc Mesnil</p>
          </div>
          <button className="sidebar-close" onClick={closeSidebar}>
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <span className="sidebar-section-label">Pilotage</span>
          {navPilotage.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={closeSidebar}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}

          <span className="sidebar-section-label" style={{ marginTop: '8px' }}>Contrôle</span>
          {navControle.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={closeSidebar}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}

          <span className="sidebar-section-label" style={{ marginTop: '8px' }}>Administratif</span>
          {navAdmin.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={closeSidebar}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">{initials}</div>
            <div className="user-info">
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
