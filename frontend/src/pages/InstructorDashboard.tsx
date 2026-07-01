import { InstructorDashboard as SharedDashboard } from '@mygames/game-ui'
import { auth, functions, rtdb } from '../firebase'
import { ROLE_LABELS } from '../gameConfig'

// Adirondacks has no shared 'deadlocked' state: a group either reaches a deal, or
// auto-resolves to no-deal after 3 failed rounds. A stuck group (absent/idle rep) is
// taken over by the instructor on the Reports page ("Resolve group", via
// updateGroupContract) — so no DeadlockResolutionControl is wired here.
export default function InstructorDashboard() {
  return (
    <SharedDashboard
      title="Instructor Dashboard — Adirondacks"
      roleLabels={ROLE_LABELS}
      functions={functions}
      auth={auth}
      rtdb={rtdb}
      settingsRoute="/settings"
      reportsRoute="/reports"
      scoreAndRecord={{ callableName: 'scoreAndRecord', label: 'Score & Record' }}
    />
  )
}
