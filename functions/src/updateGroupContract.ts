import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { validateOutcome, type Outcome } from '@mygames/game-engine'
import { extractInstructorGameId } from '@mygames/game-server'
import { adirondacksGameDef, computeRawScore } from './gameDefinition'
import { VALID_ROLES, TEXT_FIELDS, scoreBranchFor, type ReportRow } from './getReportData'

/**
 * Instructor-only. Edits a group's agreed contract from the Reports page and
 * recomputes every group member's raw_score through the 3-branch Adirondacks scorer.
 *
 * REPORT-ONLY by design — writes the group contract and each member's raw_score, and
 * NOTHING else (never normalized_score, finalized_at, or the classroom push; those are
 * scoreAndRecord / finalize).
 *
 * Input:  { groupId, agreement_reached, outcome? }
 *   - agreement_reached === false → no-deal: stored outcome null, every member gets BATNA.
 *   - agreement_reached === true  → the five-issue contract, validated against the schema.
 *     The vote metadata (deal_passed, dissenting_roles) from the CURRENT stored outcome is
 *     preserved, so FCC/ATB dissent penalties survive an issue edit. (If the group was a
 *     no-deal being converted to a deal, there is no prior dissent → nobody dissents.)
 * Output: { ok, rows } — the updated ReportRow[] for this group.
 */
export const updateGroupContract = onCall({ cors: adirondacksGameDef.corsOrigins }, async (request) => {
  const data = request.data as Record<string, unknown>
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true'
  const authHeader = request.rawRequest.headers.authorization as string | undefined

  const gameInstanceId = await extractInstructorGameId(data, isEmulator, authHeader)

  const groupId = data['groupId']
  if (typeof groupId !== 'string' || !groupId) {
    throw new HttpsError('invalid-argument', 'groupId is required.')
  }
  const agreement_reached = data['agreement_reached']
  if (typeof agreement_reached !== 'boolean') {
    throw new HttpsError('invalid-argument', 'agreement_reached must be a boolean.')
  }

  try {
    const db = admin.firestore()
    const rtdb = admin.database()
    const instanceRef = db.collection('game_instances').doc(gameInstanceId)
    const groupRef = instanceRef.collection('groups').doc(groupId)

    const groupSnap = await groupRef.get()
    if (!groupSnap.exists) {
      throw new HttpsError('not-found', `Group ${groupId} not found.`)
    }

    // Resolve the contract to store. No-deal → null. Deal → validated 5-issue contract,
    // preserving the existing vote metadata.
    let outcome: Outcome | null = null
    if (agreement_reached) {
      const provided = data['outcome']
      if (provided === null || typeof provided !== 'object' || Array.isArray(provided)) {
        throw new HttpsError('invalid-argument', 'outcome must be an object when agreement_reached is true.')
      }
      // Validate only the schema fields — strip any incoming system fields first.
      const { deal_passed: _dp, dissenting_roles: _dr, ...contractOnly } = provided as Record<string, unknown>
      const check = validateOutcome(adirondacksGameDef.outcomeSchema, contractOnly as Outcome)
      if (!check.valid) {
        throw new HttpsError('invalid-argument', `Invalid contract: ${check.errors.join(' ')}`)
      }
      // Preserve prior vote metadata so FCC/ATB dissent penalties persist across an edit.
      const prior = (groupSnap.data()?.['outcome'] ?? null) as Record<string, unknown> | null
      const dissenting_roles = Array.isArray(prior?.['dissenting_roles']) ? prior!['dissenting_roles'] : []
      outcome = { ...contractOnly, deal_passed: true, dissenting_roles } as Outcome
    }

    // 1. Persist the contract on the GROUP doc. Mark instructor-resolved, and force
    //    status:'completed' so a stalled group (still 'reporting') becomes finalize-
    //    eligible. Preserve the original completed_at if the group already finished.
    const priorCompletedAt = groupSnap.data()?.['completed_at']
    await groupRef.update({
      outcome,
      agreement_reached,
      status: 'completed',
      completed_at: priorCompletedAt ?? admin.firestore.FieldValue.serverTimestamp(),
      instructor_resolved: true,
      instructor_resolved_at: admin.firestore.FieldValue.serverTimestamp(),
    })

    // 2. Read everything needed to recompute + rebuild this group's rows.
    const [membersSnap, groupsSnap, configSnap, attendingSnap] = await Promise.all([
      instanceRef.collection('participants').where('group_id', '==', groupId).get(),
      instanceRef.collection('groups').get(),
      instanceRef.collection('config').doc('main').get(),
      rtdb.ref(`game_instances/${gameInstanceId}/attendance`).get(),
    ])

    const configData = (configSnap.data() ?? {}) as Record<string, unknown>
    const attending = (attendingSnap.val() ?? {}) as Record<string, { display_name?: string } | null>

    const sortedGroups = groupsSnap.docs.slice().sort((a, b) => a.id.localeCompare(b.id))
    const idx = sortedGroups.findIndex(g => g.id === groupId)
    const group_number = idx >= 0 ? idx + 1 : null

    // 3. Recompute each member through the 3-branch scorer; batch-write raw_score.
    const batch = db.batch()
    const rows: ReportRow[] = []

    for (const pdoc of membersSnap.docs) {
      const d = pdoc.data() as Record<string, unknown>
      const role = d['role'] as string | undefined
      if (!role || !VALID_ROLES.has(role)) continue
      if (d['finalized_at'] == null) continue

      const raw_score = computeRawScore(role, outcome, configData)
      batch.update(pdoc.ref, { raw_score })

      const rtdbName = attending[pdoc.id]?.display_name?.trim()
      const fsName   = ((d['display_name'] ?? d['name'] ?? '') as string).trim()
      const display_name = rtdbName || fsName || `${pdoc.id.slice(0, 8)}…`

      const text_answers: Record<string, string> = {}
      for (const field of TEXT_FIELDS) {
        const val = d[field]
        if (typeof val === 'string' && val.trim()) text_answers[field] = val.trim()
      }

      const branch = scoreBranchFor(role, outcome)
      rows.push({
        participant_id: pdoc.id,
        display_name,
        group_number,
        group_id: groupId,
        role,
        logging:    outcome ? (outcome['logging']    as string) : null,
        public_use: outcome ? (outcome['public_use'] as string) : null,
        safety:     outcome ? (outcome['safety']     as string) : null,
        land_price: outcome ? (outcome['land_price'] as string) : null,
        tax:        outcome ? (outcome['tax']        as string) : null,
        deal_reached: outcome !== null,
        score_branch: branch,
        batna_applied: branch === 'no_deal',
        instructor_resolved: true,
        raw_score,
        text_answers,
        notes: outcome ? ((outcome['notes'] as string | undefined) ?? null) : null,
      })
    }

    await batch.commit()

    rows.sort((a, b) => a.display_name.localeCompare(b.display_name))
    return { ok: true as const, rows }
  } catch (err) {
    if (err instanceof HttpsError) throw err
    console.error('[updateGroupContract] error:', err)
    throw new HttpsError('internal', 'Internal error')
  }
})
