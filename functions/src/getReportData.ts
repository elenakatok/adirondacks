import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import type { Outcome } from '@mygames/game-engine'
import { extractInstructorGameId } from '@mygames/game-server'
import { adirondacksGameDef, CONTRACT_FIELDS, ROLE_KEYS, DISSENT_PENALTY } from './gameDefinition'

export const VALID_ROLES = new Set<string>(ROLE_KEYS)

// Text (free-response) questions from prepDefaults — read once at module load.
export const TEXT_QUESTIONS = (adirondacksGameDef.prepDefaults ?? [])
  .filter(q => q.format === 'text' && !q.hidden)
  .map(q => ({ field: q.field, prompt: q.prompt, role_target: q.role_target }))

export const TEXT_FIELDS = TEXT_QUESTIONS.map(q => q.field)

/** How this role's raw_score arose — surfaced on the Reports page. */
export type ScoreBranch = 'deal' | 'dissent' | 'no_deal'

export type ReportRow = {
  participant_id: string
  display_name: string
  group_number: number | null
  group_id: string | null
  role: string
  // The five agreed contract issues (null when no deal).
  logging: string | null
  public_use: string | null
  safety: string | null
  land_price: string | null
  tax: string | null
  // Vote outcome, so the instructor can see WHY a role scored what it did.
  deal_reached: boolean
  /** 'deal' = scored its deal-score; 'dissent' = FCC/ATB penalty; 'no_deal' = BATNA floor. */
  score_branch: ScoreBranch
  batna_applied: boolean
  /** true when an instructor set/overrode this group's outcome via updateGroupContract. */
  instructor_resolved: boolean
  raw_score: number | null
  text_answers: Record<string, string>
  notes: string | null
}

/** Pulls the five issue fields off an outcome (or nulls when no deal). */
function issueFields(outcome: Outcome | null) {
  return {
    logging:    outcome ? (outcome['logging']    as string) : null,
    public_use: outcome ? (outcome['public_use'] as string) : null,
    safety:     outcome ? (outcome['safety']     as string) : null,
    land_price: outcome ? (outcome['land_price'] as string) : null,
    tax:        outcome ? (outcome['tax']        as string) : null,
  }
}

/** Classifies how `role` scored under the group's stored outcome. */
export function scoreBranchFor(role: string, outcome: Outcome | null): ScoreBranch {
  if (outcome === null) return 'no_deal'
  const dissenters = (outcome['dissenting_roles'] as string[] | undefined) ?? []
  if (dissenters.includes(role) && role in DISSENT_PENALTY) return 'dissent'
  return 'deal'
}

export const getReportData = onCall({ cors: adirondacksGameDef.corsOrigins }, async (request) => {
  const data = request.data as Record<string, unknown>
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true'
  const authHeader = request.rawRequest.headers.authorization as string | undefined

  const gameInstanceId = await extractInstructorGameId(data, isEmulator, authHeader)

  try {
    const db = admin.firestore()
    const rtdb = admin.database()
    const instanceRef = db.collection('game_instances').doc(gameInstanceId)

    const [participantsSnap, groupsSnap, attendingSnap] = await Promise.all([
      instanceRef.collection('participants').get(),
      instanceRef.collection('groups').get(),
      rtdb.ref(`game_instances/${gameInstanceId}/attendance`).get(),
    ])

    const attending = (attendingSnap.val() ?? {}) as Record<string, { display_name?: string } | null>

    const sortedGroups = groupsSnap.docs.slice().sort((a, b) => a.id.localeCompare(b.id))
    const groupNumberMap = new Map<string, number>(sortedGroups.map((g, i) => [g.id, i + 1]))
    const groupOutcomeMap = new Map<string, Outcome | null>(
      sortedGroups.map(g => [g.id, (g.data()['outcome'] as Outcome | null) ?? null]),
    )
    const groupResolvedMap = new Map<string, boolean>(
      sortedGroups.map(g => [g.id, g.data()['instructor_resolved'] === true]),
    )

    const rows: ReportRow[] = []

    for (const pdoc of participantsSnap.docs) {
      const d = pdoc.data() as Record<string, unknown>

      if (d['finalized_at'] == null) continue
      const role = d['role'] as string | undefined
      if (!role || !VALID_ROLES.has(role)) continue
      if (d['raw_score'] === null || d['raw_score'] === undefined) continue

      const groupId = d['group_id'] as string | undefined
      const outcome = groupId ? (groupOutcomeMap.get(groupId) ?? null) : null

      const rtdbName = attending[pdoc.id]?.display_name?.trim()
      const fsName   = ((d['display_name'] ?? d['name'] ?? '') as string).trim()
      const display_name = rtdbName || fsName || `${pdoc.id.slice(0, 8)}…`

      const branch = scoreBranchFor(role, outcome)

      const text_answers: Record<string, string> = {}
      for (const field of TEXT_FIELDS) {
        const val = d[field]
        if (typeof val === 'string' && val.trim()) text_answers[field] = val.trim()
      }

      rows.push({
        participant_id: pdoc.id,
        display_name,
        group_number: groupId ? (groupNumberMap.get(groupId) ?? null) : null,
        group_id: groupId ?? null,
        role,
        ...issueFields(outcome),
        deal_reached: outcome !== null,
        score_branch: branch,
        batna_applied: branch === 'no_deal',
        instructor_resolved: groupId ? (groupResolvedMap.get(groupId) ?? false) : false,
        raw_score: d['raw_score'] as number,
        text_answers,
        notes: outcome ? ((outcome['notes'] as string | undefined) ?? null) : null,
      })
    }

    rows.sort((a, b) => {
      const gn = (a.group_number ?? Infinity) - (b.group_number ?? Infinity)
      if (gn !== 0) return gn
      return a.display_name.localeCompare(b.display_name)
    })

    return {
      ok: true as const,
      rows,
      questions: TEXT_QUESTIONS,
      schema: adirondacksGameDef.outcomeSchema,
      contractFields: CONTRACT_FIELDS,
    }
  } catch (err) {
    if (err instanceof HttpsError) throw err
    console.error('[getReportData] error:', err)
    throw new HttpsError('internal', 'Internal error')
  }
})
