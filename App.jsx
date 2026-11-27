import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import LoginPage from './LoginPage'
import AdminLayout from './AdminLayout'
import OperatorLayout from './OperatorLayout'
import Dashboard from './Dashboard'
import DashboardTransport from './DashboardTransport'
import ColisNonRapatries from './ColisNonRapatries'
import CarrierLayout from './CarrierLayout'
import AccountSettings from './AccountSettings'
import MfaGate from './MfaGate'
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
import Notifications from './Notifications'
import Defaillances from './Defaillances'
import Checklist from './Checklist'
import PlanChargement from './PlanChargement'
import PartnerLayout from './PartnerLayout'

// Détermine la route d'accueil selon le rôle du profil
function homeForRole(role) {
  if (role === 'admin') return '/admin'
  if (role === 'partner') return '/partner'
  if (role === 'carrier') return '/carrier'
  return '/operator'
}

function LoadingPlanRoute({ children }) {
  const { profile } = useAuth()
  return profile?.can_manage_loading_plan ? children : <Navigate to="/partner" replace />
}

function CarrierManagerRoute({ children }) {
  const { profile } = useAuth()
  return profile?.can_manage_carriers ? children : <Navigate to="/partner" replace />
}

function TrackingRoute({ children }) {
  const { profile } = useAuth()
  return profile?.can_view_tour_tracking ? children : <Navigate to="/partner" replace />
}

// Compte désactivé par un administrateur : aucun accès
function InactiveAccount() {
  const { signOut } = useAuth()
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="card" style={{ padding: 28, maxWidth: 420, textAlign: 'center' }}>
        <h2 style={{ marginBottom: 8 }}>Compte désactivé</h2>
        <p style={{ color: 'var(--gray-500)', marginBottom: 16 }}>Ton accès a été désactivé. Contacte un administrateur pour le réactiver.</p>
        <button className="btn btn-primary" onClick={signOut}>Se déconnecter</button>
      </div>
    </div>
  )
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
  if (profile && profile.active === false) return <InactiveAccount />
  if (roles && !roles.includes(profile?.role)) return <Navigate to={homeForRole(profile?.role)} replace />
  return <MfaGate>{children}</MfaGate>
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
        <Route path="dashboard-transport" element={<DashboardTransport />} />
        <Route path="tours" element={<Tours />} />
        <Route path="upload" element={<UploadPDF />} />
        <Route path="users" element={<Users />} />
        <Route path="compte" element={<AccountSettings />} />
        <Route path="search-parcel" element={<SearchParcel />} />
        <Route path="search-tours" element={<SearchTours />} />
        <Route path="inventaire" element={<Inventaire />} />
        <Route path="reprises" element={<Reprises />} />
        <Route path="reference-tours" element={<ReferenceTours />} />
        <Route path="preparation-tournees" element={<PreparationTournees />} />
        <Route path="warehouse" element={<WarehousePlan />} />
        <Route path="suivi-tournees" element={<SuiviTournees />} />
        <Route path="colis-non-rapatries" element={<ColisNonRapatries />} />
        <Route path="anomalies-reception" element={<AnomaliesReception />} />
        <Route path="anomalies-preparation" element={<AnomaliesPreparation />} />
        <Route path="email-recipients" element={<EmailRecipients />} />
        <Route path="checklist" element={<Checklist />} />
        <Route path="plan-chargement" element={<PlanChargement />} />
        <Route path="colis-retour" element={<Navigate to="/admin/suivi-tournees" replace />} />
        <Route path="demandes" element={<Demandes />} />
        <Route path="compte" element={<AccountSettings />} />
        <Route path="comptes-transporteurs" element={<CarrierManagerRoute><Users carriersOnly /></CarrierManagerRoute>} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="defaillances" element={<Defaillances />} />
        <Route path="scan/:tourId" element={<ScanPage />} />
        <Route path="compte" element={<AccountSettings />} />
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
        <Route path="notifications" element={<Notifications />} />
        <Route path="defaillances" element={<Defaillances />} />
        <Route path="search-parcel" element={<SearchParcel />} />
        <Route path="suivi-tournees" element={<TrackingRoute><SuiviTournees readOnly /></TrackingRoute>} />
        <Route path="dashboard-transport" element={<TrackingRoute><DashboardTransport /></TrackingRoute>} />
        <Route path="colis-non-rapatries" element={<TrackingRoute><ColisNonRapatries /></TrackingRoute>} />
        <Route path="plan-chargement" element={<LoadingPlanRoute><PlanChargement /></LoadingPlanRoute>} />
        <Route path="destinataires-plan" element={<LoadingPlanRoute><EmailRecipients only="plan" /></LoadingPlanRoute>} />
      </Route>

      {/* Transporteur : sa qualité et ses colis non rapatriés (données filtrées côté base) */}
      <Route path="/carrier" element={<PrivateRoute roles={['carrier']}><CarrierLayout /></PrivateRoute>}>
        <Route index element={<DashboardTransport carrier />} />
        <Route path="compte" element={<AccountSettings />} />
        <Route path="colis-non-rapatries" element={<ColisNonRapatries />} />
      </Route>

      <Route path="*" element={<Navigate to={user ? homeForRole(profile?.role) : '/login'} />} />
    </Routes>
  )
}
