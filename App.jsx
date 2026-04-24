import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import LoginPage from './LoginPage'
import AdminLayout from './AdminLayout'
import OperatorLayout from './OperatorLayout'
import Dashboard from './Dashboard'
import Tours from './Tours'
import Users from './Users'
import SearchParcel from './SearchParcel'
import SearchTours from './SearchTours'
import UploadPDF from './UploadPDF'
import Reprises from './Reprises'
import ReferenceTours from './ReferenceTours'
import PreparationTournees from './PreparationTournees'
import WarehousePlan from './WarehousePlan'
import OperatorHome from './OperatorHome'
import ScanPage from './ScanPage'

function PrivateRoute({ children, adminOnly = false }) {
  const { user, profile, loading } = useAuth()
  if (loading) return (
    <div className="loading-center" style={{ height: '100vh' }}>
      <div className="spinner dark" />
      <span>Chargement...</span>
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && profile?.role !== 'admin') return <Navigate to="/operator" replace />
  return children
}

export default function App() {
  const { user, profile, loading } = useAuth()
  if (loading) return (
    <div className="loading-center" style={{ height: '100vh' }}>
      <div className="spinner dark" />
    </div>
  )

  return (
    <Routes>
      <Route path="/login" element={!user ? <LoginPage /> : <Navigate to={profile?.role === 'admin' ? '/admin' : '/operator'} />} />

      {/* Admin routes */}
      <Route path="/admin" element={<PrivateRoute adminOnly><AdminLayout /></PrivateRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="tours" element={<Tours />} />
        <Route path="upload" element={<UploadPDF />} />
        <Route path="users" element={<Users />} />
        <Route path="search-parcel" element={<SearchParcel />} />
        <Route path="search-tours" element={<SearchTours />} />
        <Route path="reprises" element={<Reprises />} />
        <Route path="reference-tours" element={<ReferenceTours />} />
        <Route path="preparation-tournees" element={<PreparationTournees />} />
        <Route path="warehouse" element={<WarehousePlan />} />
        <Route path="scan/:tourId" element={<ScanPage />} />
      </Route>

      {/* Operator routes */}
      <Route path="/operator" element={<PrivateRoute><OperatorLayout /></PrivateRoute>}>
        <Route index element={<OperatorHome />} />
        <Route path="scan/:tourId" element={<ScanPage />} />
      </Route>

      <Route path="*" element={<Navigate to={user ? (profile?.role === 'admin' ? '/admin' : '/operator') : '/login'} />} />
    </Routes>
  )
}
