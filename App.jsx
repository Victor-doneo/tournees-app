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
import Inventaire from './Inventaire'
import UploadPDF from './UploadPDF'
import Reprises from './Reprises'
import ReferenceTours from './ReferenceTours'
import PreparationTournees from './PreparationTournees'
import WarehousePlan from './WarehousePlan'
import SuiviTournees from './SuiviTournees'
import AnomaliesReception from './AnomaliesReception'
import AnomaliesPreparation from './AnomaliesPreparation'
import EmailRecipients from './EmailRecipients'
import OperatorHome from './OperatorHome'
import ScanPage from './ScanPage'
import Demandes from './Demandes'
import Defaillances from './Defaillances'
import Checklist from './Checklist'
import PlanChargement from './PlanChargement'
import PartnerLayout from './PartnerLayout'

// Détermine la route d'accueil selon le rôle du profil
function homeForRole(role) {
  if (role === 'admin') return '/admin'
  if (role === 'partner') return '/partner'
  return '/operator'
}

function LoadingPlanRoute({ children }) {
  const { profile } = useAuth()
  return profile?.can_manage_loading_plan ? children : <Navigate to="/partner" replace />
}

function PrivateRoute({ children, roles }) {
  const { user, profile, loading } = useAuth()
  if (loading) return (
    <div className="loading-center" style={{ height: '100vh' }}>
      <div className="spinner dark" />
      <span>Chargement...</span>
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(profile?.role)) return <Navigate to={homeForRole(profile?.role)} replace />
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
      <Route path="/login" element={!user ? <LoginPage /> : <Navigate to={homeForRole(profile?.role)} />} />

      {/* Admin routes */}
      <Route path="/admin" element={<PrivateRoute roles={['admin']}><AdminLayout /></PrivateRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="tours" element={<Tours />} />
        <Route path="upload" element={<UploadPDF />} />
        <Route path="users" element={<Users />} />
        <Route path="search-parcel" element={<SearchParcel />} />
        <Route path="search-tours" element={<SearchTours />} />
        <Route path="inventaire" element={<Inventaire />} />
        <Route path="reprises" element={<Reprises />} />
        <Route path="reference-tours" element={<ReferenceTours />} />
        <Route path="preparation-tournees" element={<PreparationTournees />} />
        <Route path="warehouse" element={<WarehousePlan />} />
        <Route path="suivi-tournees" element={<SuiviTournees />} />
        <Route path="anomalies-reception" element={<AnomaliesReception />} />
        <Route path="anomalies-preparation" element={<AnomaliesPreparation />} />
        <Route path="email-recipients" element={<EmailRecipients />} />
        <Route path="checklist" element={<Checklist />} />
        <Route path="plan-chargement" element={<PlanChargement />} />
        <Route path="demandes" element={<Demandes />} />
        <Route path="defaillances" element={<Defaillances />} />
        <Route path="scan/:tourId" element={<ScanPage />} />
      </Route>

      {/* Operator routes */}
      <Route path="/operator" element={<PrivateRoute roles={['operator', 'admin']}><OperatorLayout /></PrivateRoute>}>
        <Route index element={<OperatorHome />} />
        <Route path="inventaire" element={<Inventaire />} />
        <Route path="search-parcel" element={<SearchParcel />} />
        <Route path="scan/:tourId" element={<ScanPage />} />
      </Route>

      {/* Partner routes — accès restreint au suivi des tâches et à la recherche colis */}
      <Route path="/partner" element={<PrivateRoute roles={['partner']}><PartnerLayout /></PrivateRoute>}>
        <Route index element={<Demandes />} />
        <Route path="defaillances" element={<Defaillances />} />
        <Route path="search-parcel" element={<SearchParcel />} />
        <Route path="plan-chargement" element={<LoadingPlanRoute><PlanChargement /></LoadingPlanRoute>} />
        <Route path="destinataires-plan" element={<LoadingPlanRoute><EmailRecipients only="plan" /></LoadingPlanRoute>} />
      </Route>

      <Route path="*" element={<Navigate to={user ? homeForRole(profile?.role) : '/login'} />} />
    </Routes>
  )
}
