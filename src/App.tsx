import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider, useAuth } from './auth'
import { Layout } from './components/Layout'
import { FeedbackProvider } from './components/ui'
import { SAMPLE_BASE, isSample } from './lib/mode'
import { isConfigured } from './lib/supabase'
import { GamePage } from './pages/Game'
import { AdminPage, AdminStandalone } from './pages/Admin'
import { DealerPage, DealersPage } from './pages/Dealers'
import { BootLoading, ErrorPage, LoginPage, OnboardingPage, SetupPage } from './pages/Gate'
import { GamesPage } from './pages/Games'
import { HistoryPage } from './pages/History'
import { OrganizationPage } from './pages/Organization'
import { PartnerPage, PartnersPage } from './pages/Partners'
import { PlayerPage } from './pages/Player'
import { PlayersPage } from './pages/Players'

function Routed() {
  const { state, org, isOwner } = useAuth()
  if (state.status === 'loading') return <BootLoading />
  if (state.status === 'signed_out') return <LoginPage />
  // The owner can always manage accounts and organizations, even before joining one.
  if (state.status === 'no_org') return isOwner ? <AdminStandalone /> : <OnboardingPage />
  if (state.status === 'error') return <ErrorPage error={state.error} />
  return (
    // Keyed by organization so switching orgs reloads every screen.
    <Routes key={org?.id}>
      <Route element={<Layout />}>
        <Route index element={<GamesPage />} />
        <Route path="games/:id" element={<GamePage />} />
        <Route path="players" element={<PlayersPage />} />
        <Route path="players/:id" element={<PlayerPage />} />
        <Route path="partners" element={<PartnersPage />} />
        <Route path="partners/:id" element={<PartnerPage />} />
        <Route path="dealers" element={<DealersPage />} />
        <Route path="dealers/:id" element={<DealerPage />} />
        {/* The history is for the app owner only (the database enforces it too). */}
        <Route path="history" element={isOwner ? <HistoryPage /> : <Navigate to="/" replace />} />
        <Route path="org" element={<OrganizationPage />} />
        {isOwner && <Route path="admin" element={<AdminPage />} />}
        <Route path="club" element={<Navigate to="/org" replace />} />
        <Route path="team" element={<Navigate to="/org" replace />} />
        <Route path="*" element={<GamesPage />} />
      </Route>
    </Routes>
  )
}

export function App() {
  return (
    <FeedbackProvider>
      {isConfigured || isSample ? (
        <BrowserRouter basename={isSample ? SAMPLE_BASE : undefined}>
          <AuthProvider>
            <Routed />
          </AuthProvider>
        </BrowserRouter>
      ) : (
        <SetupPage />
      )}
    </FeedbackProvider>
  )
}
