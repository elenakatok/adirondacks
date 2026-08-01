// ═══════════════════════════════════════════════════════════════════════════════
// ADIRONDACKS — instructor move / ungroup (CLASSROOM MODE).
//
// Instructor_Move_Ungroup_Shared_Spec_v3, Phase 3 rollout (following winemaster + vivo +
// claridge). Consumes the EXISTING shared factory `makeMoveSeat` via the negotiation
// group-doc adapter; no shared game-server source is changed here.
//
// SIX ROLES: the adapter is built from roleKeys(adirondacksGameDef.roles) = gpp, ala, flp,
// fcc, governor, atb — so writeMembership partitions a moved occupant into the correct one
// of the six `<role>_participants` arrays. The `remnantGroup` mechanic is a MATCHING-time
// concern (makeTriggerMatching) and is orthogonal to move/ungroup: this callable just moves
// a participant (by their existing role) between already-formed groups, whatever their
// composition (a full group of 12, a remnant group of 6, or a lopsided leftover).
//
// SCOPE: classroom move/ungroup only. Online-mode grouping callables are NOT wired.
// ═══════════════════════════════════════════════════════════════════════════════

import { HttpsError } from 'firebase-functions/v2/https'
import { roleKeys } from '@mygames/game-engine'
import {
  makeMoveSeat,
  makeNegotiationGroupAdapter,
  type OnlineContext,
  type OnlineDefinition,
} from '@mygames/game-server'
import { adirondacksGameDef } from './gameDefinition'

/**
 * NO SIZE CAP (spec §2). "Lopsided groups are legal … a student may move into ANY
 * not-started group" — the same decision as the latecomer spec's no-size-caps. The pure
 * seat op (moveOccupant) needs a finite seatCount to test fullness; this sentinel sits far
 * above any real adirondacks group (nominal 12, remnant 6) so a manual move never bounces on
 * size. It is NOT a real capacity, and negotiation groups hold no bots, so the bot-eviction
 * path that seatCount also guards can never fire here.
 */
const NO_SEAT_CAP = 999

const onlineDef: OnlineDefinition = {
  seatCount: NO_SEAT_CAP,
  // Negotiation is human-vs-human — bots never exist (spec §2 / §6). makeMoveSeat never
  // calls this (only topUpGroupWithBots does, which adirondacks does not export); present
  // because OnlineDefinition requires it, and throws so an accidental future wiring of
  // bot-fill fails loudly rather than minting a phantom seat.
  makeBotSeat: () => {
    throw new HttpsError('failed-precondition', 'Adirondacks is a negotiation game — bots are never used.')
  },
}

const ctx: OnlineContext = {
  def: adirondacksGameDef,
  online: onlineDef,
  adapter: makeNegotiationGroupAdapter(roleKeys(adirondacksGameDef.roles)),
}

/**
 * Instructor move / ungroup / place-into-new-group — ONE callable, three behaviours keyed
 * by `target_group_id`:  ''  ungroup (seat frees, group stands),  'new'  create a group,
 * else a group id → move into it. Args: { participant_id, target_group_id }.
 *
 * The per-group lock is REAL and enforced server-side: the negotiation adapter's
 * hasStarted (negotiation_started_at set OR status 'negotiating') freezes a started group
 * for moves IN and OUT. A group that voting.ts has advanced to 'reporting' or 'completed'
 * has negotiation_started_at set (it went through startNegotiation first), so it reads as
 * started and is correctly frozen — a later-lifecycle group is never treated as movable.
 * The student keeps their role — the pure seat op carries each occupant's role and the
 * adapter writes it back into that role's `<role>_participants` array (one of the six).
 */
export const moveSeat = makeMoveSeat(ctx)
