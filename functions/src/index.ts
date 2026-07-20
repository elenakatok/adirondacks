import { onRequest } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import {
  makeGetInstructorSession,
  makeAssignRole,
  makeCompletePrep,
  makeConfirmReady,
  makeGenerateAttendanceCode,
  makeVerifyAttendanceCode,
  makeGetRoster,
  makeSyncRoster,
  makeTriggerMatching,
  makeStartNegotiation,
  makeGetGroupMemberEmails,
  makeFinalizeInstance,
  makePushResultsToClassroom,
  makeGetGameConfig,
  makeUpdateGameConfig,
  validateKCGate,
  makeGetStudentPrepQuestions,
  makeGetDebriefQuestions,
  makeSubmitKnowledgeCheck,
  makeSubmitStaticKnowledgeCheckQuestion,
  makeGetInfoUrls,
} from '@mygames/game-server'
import { adirondacksGameDef } from './gameDefinition'

admin.initializeApp()

// ── KC gate validation (cold-start; loud failure if gate is misconfigured) ────
const _kcGateError = validateKCGate(
  adirondacksGameDef.roles.roles.map(r => r.key),
  adirondacksGameDef.prepDefaults ?? [],
)
if (_kcGateError) throw new Error(`Adirondacks KC gate validation failed: ${_kcGateError}`)

// ── Game endpoints (onCall, via game-server factories + Adirondacks definition) ──

export const getInstructorSession  = makeGetInstructorSession(adirondacksGameDef)
export const assignRole             = makeAssignRole(adirondacksGameDef)
export const completePrep           = makeCompletePrep(adirondacksGameDef)
export const confirmReady           = makeConfirmReady(adirondacksGameDef)
export const generateAttendanceCode = makeGenerateAttendanceCode(adirondacksGameDef)
export const verifyAttendanceCode   = makeVerifyAttendanceCode(adirondacksGameDef)
export const getRoster              = makeGetRoster(adirondacksGameDef)
export const syncRoster             = makeSyncRoster(adirondacksGameDef)
export const triggerMatching        = makeTriggerMatching(adirondacksGameDef)
export const startNegotiation       = makeStartNegotiation(adirondacksGameDef)
export const getGroupMemberEmails      = makeGetGroupMemberEmails(adirondacksGameDef)
// ── Adirondacks-specific voting (Part 4) — replaces the shared unanimous flow for
//    THIS game only. No submitInstructorOutcome: there is no instructor fallback;
//    the 3rd failed proposal round is the resolution (automatic no-deal).
export { submitLeadOutcome, submitConfirmation } from './voting'
export const finalizeInstance       = makeFinalizeInstance(adirondacksGameDef)
export const pushResultsToClassroom = makePushResultsToClassroom(adirondacksGameDef)
export const getGameConfig          = makeGetGameConfig(adirondacksGameDef)
export const updateGameConfig       = makeUpdateGameConfig(adirondacksGameDef)
export const getStudentPrepQuestions            = makeGetStudentPrepQuestions(adirondacksGameDef)
export const getDebriefQuestions                = makeGetDebriefQuestions(adirondacksGameDef)
export const submitKnowledgeCheck               = makeSubmitKnowledgeCheck(adirondacksGameDef)
export const submitStaticKnowledgeCheckQuestion = makeSubmitStaticKnowledgeCheckQuestion(adirondacksGameDef)
export const getInfoUrls                        = makeGetInfoUrls(adirondacksGameDef)
export { getReportData } from './getReportData'
export { updateGroupContract } from './updateGroupContract'
export { scoreAndRecord } from './scoreAndRecord'

// ── Non-game onRequest endpoints ──────────────────────────────────────────────

const CORS_ORIGINS = new Set(['https://adirondacks.mygames.live'])

export const health = onRequest((req, res) => {
  const origin = req.headers.origin ?? ''
  if (CORS_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin)
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.set('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') { res.status(204).send(''); return }
  res.json({ ok: true, game: 'adirondacks' })
})

// Emulator-only dev seed functions.
export { seedMatchTest, seedGroupForTest } from './seedFunctions'
