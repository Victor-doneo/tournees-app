import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { LogOut, Menu, X, Truck, Search, ClipboardCheck } from 'lucide-react'

const navOperator = [
  { to: '/operator', label: 'Tournées', icon: <Truck size={16} />, end: true },
  { to: '/operator/inventaire', label: 'Inventaire', icon: <ClipboardCheck size={16} /> },
  { to: '/operator/search-parcel', label: 'Recherche colis', icon: <Search size={16} /> },
]

export default function OperatorLayout() {
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

  return (
    <div className="app-layout">

      {/* Overlay mobile */}
      <div
        className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-logo">
          <div>
            <h1>CCV<span>.</span></h1>
            <p>Opérateur</p>
          </div>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {navOperator.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">{initials}</div>
            <div className="user-info" role="link" tabIndex={0} title="Mon compte (mot de passe, double authentification)" style={{ cursor: 'pointer' }} onClick={() => navigate('/operator/compte')} onKeyDown={e => { if (e.key === 'Enter') navigate('/operator/compte') }}>
              <div className="user-name">{profile?.full_name || profile?.email}</div>
              <div className="user-role">Opérateur</div>
            </div>
            <button className="btn-logout" onClick={handleSignOut} title="Déconnexion">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">
        {/* Topbar mobile */}
        <div className="mobile-topbar">
          <button className="btn-menu" onClick={() => setSidebarOpen(true)}>
            <Menu size={22} />
          </button>
          <span className="mobile-topbar-logo">CCV<span>.</span></span>
          <div className="user-avatar" style={{ width: 32, height: 32, fontSize: 11 }}>
            {initials}
          </div>
        </div>

        <Outlet />
      </main>
    </div>
  )
}
