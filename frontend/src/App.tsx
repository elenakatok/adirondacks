import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { auth, functions } from './firebase'
import Play from './pages/Play'
import InstructorDashboard from './pages/InstructorDashboard'
import Configure from './pages/Configure'
import Reports from './pages/Reports'
import { SettingsPage } from '@mygames/game-ui'
import { adirondacksConfig, ROLE_LABELS } from './gameConfig'

// Info links mirror functions/src/gameDefinition.ts roleInfoLinks: each role links its
// own case brief (PDF) + scoring worksheet (xlsx). Keys must match configFields.
const adirondacksInfoLinks = adirondacksConfig.roles.map(r => ({
  roleKey: r.key,
  links: [
    { key: `${r.key}_sheet_url`,     label: 'Role brief' },
    { key: `${r.key}_worksheet_url`, label: 'Scoring worksheet' },
  ],
}))

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"          element={<Play />} />
        <Route path="/dashboard" element={<InstructorDashboard />} />
        <Route path="/configure" element={<Configure />} />
        <Route path="/reports"   element={<Reports />} />
        <Route path="/settings"  element={
          <SettingsPage
            title="Settings — Adirondacks"
            functions={functions}
            auth={auth}
            roleLabels={ROLE_LABELS}
            roleInfoLinks={adirondacksInfoLinks}
          />
        } />
      </Routes>
    </BrowserRouter>
  )
}
