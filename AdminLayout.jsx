import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import {
  LayoutDashboard, Truck, Upload, Users, Search, FileSearch, LogOut
} from 'lucide-react'

const navItems = [
  { to: '/admin', label: 'Dashboard', icon: <LayoutDashboard size={16} />, end: true },
  { to: '/admin/tours', label: 'Tournées', icon: <Truck size={16} /> },
  { to: '/admin/upload', label: 'Importer un PDF', icon: <Upload size={16} /> },
]

const navItems2 = [
  { to: '/admin/search-parcel', label: 'Recherche colis', icon: <Search size={16} /> },
  { to: '/admin/search-tours', label: 'Recherche tournées', icon: <FileSearch size={16} /> },
  { to: '/admin/users', label: 'Utilisateurs', icon: <Users size={16} /> },
]

export default function AdminLayout() {
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
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>CCV<span>.</span></h1>
          <p>Administration</p>
        </div>

        <nav className="sidebar-nav">
          <span className="sidebar-section-label">Principal</span>
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}

          <span className="sidebar-section-label" style={{ marginTop: '8px' }}>Outils</span>
          {navItems2.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
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
        <Outlet />
      </main>
    </div>
  )
}
