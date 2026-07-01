/**
 * Adirondacks-specific voting (Part 4). Replaces the shared unanimous confirm flow
 * FOR THIS GAME ONLY — the shared makeSubmitLeadOutcome/makeSubmitConfirmation are
 * untouched (Winemaster/Hawks/etc. still use them). Built on the shared, opt-in
 * approval primitives (applyApproval + resolveStatus threshold mode) from game-engine
 * v0.5.0.
 *
 * The flow:
 *   1. GPP's representative (the group lead) proposes a 5-issue contract.
 *   2. Each of the other 5 roles has ONE representative (the first participant in that
 *      role's shuffled group array) who casts the role's single vote. Non-reps observe.
 *   3. A deal is signed when ≥5 of 6 roles approve — GPP auto-approves as proposer, so
 *      ≥4 of the 5 reps must confirm (APPROVE_THRESHOLD) — AND every conditional vetoer
 *      approves (FLP if land tenders money, Governor if a tax break is granted).
 *   4. A failed round returns the proposal to GPP to revise. After MAX_ROUNDS (3) failed
 *      rounds the group is an automatic NO DEAL (branch-3 BATNA scoring). There is no
 *      instructor fallback on this game.
 *
 * The committed outcome stored on the group carries two system fields the scorer reads:
 *   deal_passed: true, dissenting_roles: string[]   (see gameDefinition.computeRawScore).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  validateOutcome,
  initialApprovalState,
  applyApproval,
  resolveStatus,
  roleKeys,
  fieldFor,
  type ApprovalDecision,
  type ApprovalState,
} from '@mygames/game-engine'
import { extractStudentOnCallIds } from '@mygames/game-server'
import {
  adirondacksGameDef,
  VOTE_ROLES,
  APPROVE_THRESHOLD,
  MAX_ROUNDS,
  requiredApproverRoles,
  computeRawScore,
} from './gameDefinition'

const def = adirondacksGameDef

/** rep for a role = first participant in that role's group array (shuffle-randomised at match). */
function repFor(gdata: Record<string, unknown>, roleKey: string): string | undefined {
  const arr = gdata[fieldFor(roleKey, 'participants')] as string[] | undefined
  return arr && arr.length > 0 ? arr[0] : undefined
}

/**
 * GPP representative (group lead) proposes / re-proposes the 5-issue contract.
 * Builds the confirmations map over the 5 non-GPP role representatives only.
 */
export const submitLeadOutcome = onCall({ cors: def.corsOrigins }, async (request) => {
  const data = request.data as Record<string, unknown>
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true'
  const authHeader = request.rawRequest.headers.authorization as string | undefined
  const { participantId, gameInstanceId } = await extractStudentOnCallIds(data, isEmulator, authHeader)

  if (!('outcome' in data) || data['outcome'] === null || typeof data['outcome'] !== 'object' || Array.isArray(data['outcome'])) {
    throw new HttpsError('invalid-argument', 'outcome must be a contract object (Adirondacks has no manual no-deal — it results from 3 failed rounds).')
  }
  const contract = data['outcome'] as Record<string, unknown>
  const validation = validateOutcome(def.outcomeSchema, contract)
  if (!validation.valid) {
    throw new HttpsError('invalid-argument', `Invalid contract: ${validation.errors.join('; ')}`)
  }

  try {
    const db = admin.firestore()
    const instanceRef = db.collection('game_instances').doc(gameInstanceId)

    const pSnap = await instanceRef.collection('participants').doc(participantId).get()
    if (!pSnap.exists) throw new HttpsError('not-found', 'Participant not found.')
    const pdata = pSnap.data()!
    if (!pdata['group_id']) throw new HttpsError('failed-precondition', 'Not in a group.')
    if (!pdata['is_lead']) throw new HttpsError('permission-denied', 'Only GPP’s representative may propose the contract.')

    const groupRef = instanceRef.collection('groups').doc(pdata['group_id'] as string)
    const gSnap = await groupRef.get()
    if (!gSnap.exists) throw new HttpsError('not-found', 'Group not found.')
    const gdata = gSnap.data()!

    if (gdata['status'] === 'completed') throw new HttpsError('failed-precondition', 'Outcome already resolved.')
    if (gdata['status'] === 'reporting' && gdata['lead_reported_at'] != null) {
      throw new HttpsError('failed-precondition', 'Already proposed this round. Waiting for the other parties to vote.')
    }

    // Approvers = the single representative of each of the 5 non-GPP roles.
    const approverIds = VOTE_ROLES
      .map((role) => repFor(gdata, role))
      .filter((id): id is string => id != null)
    const { confirmations } = initialApprovalState(approverIds)

    await groupRef.update({
      status: 'reporting',
      lead_outcome: contract,
      lead_reported_at: FieldValue.serverTimestamp(),
      confirmations,
    })
    return { ok: true as const }
  } catch (err) {
    if (err instanceof HttpsError) throw err
    console.error('[submitLeadOutcome/adk] error:', err)
    throw new HttpsError('internal', 'Internal error')
  }
})

/**
 * A role representative casts its role's single approve/reject vote on GPP's proposal.
 * Resolves the round via threshold mode: ≥APPROVE_THRESHOLD confirmations AND every
 * conditional vetoer confirmed → signed; otherwise the round fails (reset, or auto
 * no-deal on the 3rd failure).
 */
export const submitConfirmation = onCall({ cors: def.corsOrigins }, async (request) => {
  const data = request.data as Record<string, unknown>
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true'
  const authHeader = request.rawRequest.headers.authorization as string | undefined
  const { participantId, gameInstanceId } = await extractStudentOnCallIds(data, isEmulator, authHeader)

  if (typeof data['confirmed'] !== 'boolean') {
    throw new HttpsError('invalid-argument', 'confirmed must be boolean')
  }
  const confirmed = data['confirmed']

  try {
    const db = admin.firestore()
    const instanceRef = db.collection('game_instances').doc(gameInstanceId)

    const pSnap = await instanceRef.collection('participants').doc(participantId).get()
    if (!pSnap.exists) throw new HttpsError('not-found', 'Participant not found.')
    const pdata = pSnap.data()!
    if (!pdata['group_id']) throw new HttpsError('failed-precondition', 'Not in a group.')
    if (pdata['is_lead']) throw new HttpsError('permission-denied', 'GPP’s representative proposes via submitLeadOutcome.')
    const callerRole = pdata['role'] as string

    const groupRef = instanceRef.collection('groups').doc(pdata['group_id'] as string)

    // Widened to string so control-flow analysis doesn't narrow away the closure writes.
    let txOutcome = 'waiting'
    let lockedOutcome: Record<string, unknown> | null = null
    const lockedParticipants: Array<{ participantId: string; role: string }> = []

    await db.runTransaction(async (tx) => {
      const gSnap = await tx.get(groupRef)
      if (!gSnap.exists) throw new HttpsError('not-found', 'Group not found.')
      const gdata = gSnap.data()!

      if (gdata['status'] !== 'reporting') {
        throw new HttpsError('failed-precondition', `Cannot vote — group is '${gdata['status'] as string}'.`)
      }
      if (gdata['lead_reported_at'] == null) {
        throw new HttpsError('failed-precondition', 'GPP has not proposed a contract yet.')
      }

      // Only the designated representative of the caller's role may vote.
      const rep = repFor(gdata, callerRole)
      if (rep !== participantId) {
        throw new HttpsError('permission-denied', 'You are an observer for your role — only your role’s representative casts the vote.')
      }

      const storedConfs = (gdata['confirmations'] ?? {}) as Record<string, ApprovalDecision>
      if (storedConfs[participantId] === undefined) {
        throw new HttpsError('failed-precondition', 'You are not an eligible voter for this proposal.')
      }
      if (storedConfs[participantId] !== 'pending') {
        throw new HttpsError('failed-precondition', 'Already voted this round.')
      }

      const state: ApprovalState = { confirmations: storedConfs }
      const newState = applyApproval(state, { participantId, decision: confirmed ? 'confirmed' : 'rejected' })

      const contract = gdata['lead_outcome'] as Record<string, unknown>
      const requiredApproverIds = requiredApproverRoles(contract)
        .map((role) => repFor(gdata, role))
        .filter((id): id is string => id != null)

      const resolution = resolveStatus(newState, {
        approveThreshold: APPROVE_THRESHOLD,
        requiredApproverIds,
      })

      if (resolution === 'committed') {
        // Which roles' reps dissented (voted reject) on the passing proposal.
        const dissenting_roles = VOTE_ROLES.filter((role) => {
          const r = repFor(gdata, role)
          return r != null && newState.confirmations[r] === 'rejected'
        })
        const augmented = { ...contract, deal_passed: true, dissenting_roles }
        tx.update(groupRef, {
          outcome: augmented,
          agreement_reached: true,
          status: 'completed',
          completed_at: FieldValue.serverTimestamp(),
          confirmations: newState.confirmations,
        })
        txOutcome = 'locked'
        lockedOutcome = augmented
        for (const roleKey of roleKeys(def.roles)) {
          const pids = (gdata[fieldFor(roleKey, 'participants')] ?? []) as string[]
          for (const pid of pids) lockedParticipants.push({ participantId: pid, role: roleKey })
        }
      } else if (resolution === 'reset') {
        const resetCount = ((gdata['reset_count'] as number | undefined) ?? 0) + 1
        if (resetCount >= MAX_ROUNDS) {
          // 3rd failed round → automatic NO DEAL (branch-3 BATNA at finalize).
          tx.update(groupRef, {
            status: 'completed',
            outcome: null,
            agreement_reached: false,
            completed_at: FieldValue.serverTimestamp(),
            reset_count: resetCount,
            confirmations: newState.confirmations,
          })
          txOutcome = 'no_deal'
        } else {
          // Failed round → return to GPP to revise; reset all votes to pending.
          const resetConfs: Record<string, ApprovalDecision> = {}
          for (const pid of Object.keys(storedConfs)) resetConfs[pid] = 'pending'
          tx.update(groupRef, {
            reset_count: resetCount,
            lead_outcome: null,
            lead_reported_at: null,
            confirmations: resetConfs,
          })
          txOutcome = 'rejected'
        }
      } else {
        // 'awaiting' — record this vote (confirm OR reject); round tallies once all vote.
        tx.update(groupRef, { [`confirmations.${participantId}`]: confirmed ? 'confirmed' : 'rejected' })
        txOutcome = 'waiting'
      }
    })

    // Early raw_score write on a signed deal (finalize recomputes identically).
    if (txOutcome === 'locked' && lockedParticipants.length > 0) {
      try {
        const scoreBatch = db.batch()
        for (const { participantId: pid, role } of lockedParticipants) {
          scoreBatch.update(instanceRef.collection('participants').doc(pid), {
            raw_score: computeRawScore(role, lockedOutcome),
          })
        }
        await scoreBatch.commit()
      } catch (err) {
        console.error('[submitConfirmation/adk] raw_score early write failed (non-fatal):', err)
      }
    }

    return { ok: true as const, outcome: txOutcome }
  } catch (err) {
    if (err instanceof HttpsError) throw err
    console.error('[submitConfirmation/adk] error:', err)
    throw new HttpsError('internal', 'Internal error')
  }
})
