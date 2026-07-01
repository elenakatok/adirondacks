import type { Outcome, OutcomeSchema, RoleConfig } from '@mygames/game-engine'
import type { GameDefinition } from '@mygames/game-server'

// ── Role config ───────────────────────────────────────────────────────────────
// Six parties negotiating a conservation easement over Adirondack Park land.
// GPP is roles[0] deliberately: it is the proposer/lead who conducts the up-or-down
// vote (see the Adirondacks-local submitLeadOutcome/submitConfirmation). Keys lowercase.

export const adirondacksConfig: RoleConfig = {
  roles: [
    { key: 'gpp',      label: 'GPP',                            short: 'GPP' }, // Global Pulp & Paper — proposer/lead
    { key: 'ala',      label: 'Adirondack Logging Association', short: 'ALA' },
    { key: 'flp',      label: 'Forest Legacy Program',          short: 'FLP' },
    { key: 'fcc',      label: 'Forest Conservation Committee',  short: 'FCC' },
    { key: 'governor', label: 'The Governor',                   short: 'Gov' },
    { key: 'atb',      label: 'Adirondack Tourism Board',       short: 'ATB' },
  ],
}

export const ROLE_KEYS = ['gpp', 'ala', 'flp', 'fcc', 'governor', 'atb'] as const
export type AdkRole = (typeof ROLE_KEYS)[number]

// ── Outcome schema (the 5-issue contract) ────────────────────────────────────
// One shared contract per group — five single-select dropdowns plus optional Notes.
// Enum values ARE the display labels (tax as "0%".."37%" — displayed as percentages).
// The vote result is layered onto the stored outcome at commit time as two system
// fields (deal_passed, dissenting_roles) that the scorer reads; they are NOT part of
// the schema the lead submits (the lead proposes only the five issues + notes).

export const LOGGING_OPTIONS    = ['Clear Cut', 'Sustainable with Roads', 'Sustainable without Roads'] as const
export const PUBLIC_USE_OPTIONS = ['Wilderness', 'Recreation', 'Mechanized Vehicles'] as const
export const SAFETY_OPTIONS     = ['Exceed OSHA', 'Improve on OSHA', 'Full OSHA Compliance', 'Basic OSHA Compliance'] as const
export const LAND_PRICE_OPTIONS = ['$50 million', '$25 million', '$10 million', 'No Cost, Donated'] as const
export const TAX_OPTIONS        = ['0%', '5%', '15%', '25%', '37%'] as const

/** The five contract issue keys, in display order. */
export const CONTRACT_FIELDS = ['logging', 'public_use', 'safety', 'land_price', 'tax'] as const

export const adirondacksSchema: OutcomeSchema = [
  { key: 'logging',    type: 'enum', options: [...LOGGING_OPTIONS] },
  { key: 'public_use', type: 'enum', options: [...PUBLIC_USE_OPTIONS] },
  { key: 'safety',     type: 'enum', options: [...SAFETY_OPTIONS] },
  { key: 'land_price', type: 'enum', options: [...LAND_PRICE_OPTIONS] },
  { key: 'tax',        type: 'enum', options: [...TAX_OPTIONS] },
  { key: 'notes',      type: 'text' }, // optional free-text; blank = '', excluded from scoring
]

// ── Score sense (all value-sense — higher points = better for that role) ─────
export const adirondacksScoreSense: Record<string, 'value' | 'cost'> = {
  gpp: 'value', ala: 'value', flp: 'value', fcc: 'value', governor: 'value', atb: 'value',
}

// ── Frozen scoring vector (verified cell-for-cell against Adirondack_Scoring.xlsx
//    and all six V6 role sheets). issue → option → { role: points }. Every role
//    min 0 / max 100 across any single-option selection.
export const POINTS: Record<string, Record<string, Record<AdkRole, number>>> = {
  logging: {
    'Clear Cut':                 { governor: 0,  flp: 0,  fcc: 0,  ala: 9,  atb: 0,  gpp: 14 },
    'Sustainable with Roads':    { governor: 14, flp: 16, fcc: 25, ala: 20, atb: 14, gpp: 8  },
    'Sustainable without Roads': { governor: 8,  flp: 8,  fcc: 55, ala: 0,  atb: 30, gpp: 0  },
  },
  public_use: {
    'Wilderness':          { governor: 0,  flp: 0,  fcc: 45, ala: 0,  atb: 0,  gpp: 2 },
    'Recreation':          { governor: 15, flp: 25, fcc: 22, ala: 10, atb: 18, gpp: 4 },
    'Mechanized Vehicles': { governor: 20, flp: 20, fcc: 0,  ala: 5,  atb: 45, gpp: 0 },
  },
  safety: {
    'Exceed OSHA':           { governor: 15, flp: 9, fcc: 0, ala: 42, atb: 0, gpp: 0  },
    'Improve on OSHA':       { governor: 12, flp: 4, fcc: 0, ala: 30, atb: 0, gpp: 5  },
    'Full OSHA Compliance':  { governor: 10, flp: 2, fcc: 0, ala: 20, atb: 0, gpp: 10 },
    'Basic OSHA Compliance': { governor: 0,  flp: 0, fcc: 0, ala: 0,  atb: 0, gpp: 17 },
  },
  land_price: {
    '$50 million':      { governor: 20, flp: 10, fcc: 0, ala: 20, atb: 10, gpp: 35 },
    '$25 million':      { governor: 15, flp: 26, fcc: 0, ala: 15, atb: 9,  gpp: 29 },
    '$10 million':      { governor: 11, flp: 40, fcc: 0, ala: 10, atb: 6,  gpp: 20 },
    'No Cost, Donated': { governor: 0,  flp: 0,  fcc: 0, ala: 0,  atb: 0,  gpp: 0  },
  },
  tax: {
    '0%':  { governor: 31, flp: 0,  fcc: 0, ala: 8, atb: 15, gpp: 0  },
    '5%':  { governor: 27, flp: 2,  fcc: 0, ala: 6, atb: 12, gpp: 5  },
    '15%': { governor: 16, flp: 6,  fcc: 0, ala: 4, atb: 8,  gpp: 17 },
    '25%': { governor: 10, flp: 8,  fcc: 0, ala: 2, atb: 3,  gpp: 25 },
    '37%': { governor: 0,  flp: 10, fcc: 0, ala: 0, atb: 0,  gpp: 30 },
  },
}

// ── No-deal floors (BATNA) and dissent penalties ─────────────────────────────
// BATNA (branch 3 — no deal after 3 rounds): every role scores its floor and stays
// in the z-pool. DISSENT_PENALTY (branch 2 — a deal PASSED but this role's rep voted
// against it): only FCC and ATB carry a distinct "a deal was made you're not part of"
// value in their V6 worksheets; every other role that dissents in a passed deal still
// receives its computed deal-score (branch 1).
export const BATNA: Record<AdkRole, number> = {
  gpp: 45, governor: 45, flp: 65, ala: 50, fcc: 75, atb: 85,
}
export const DISSENT_PENALTY: Partial<Record<AdkRole, number>> = {
  fcc: 70, atb: 65,
}

// ── Voting mechanics (Adirondacks-specific; consumed by the local factories) ──
// GPP is the proposer/lead and auto-approves its own proposal, so it is NOT in the
// confirmations map. A deal needs ≥5 of 6 total approvals → ≥4 of the 5 non-GPP role
// representatives, PLUS the conditional vetoers below must approve.
export const VOTE_ROLES: AdkRole[] = ['ala', 'flp', 'fcc', 'governor', 'atb'] // the 5 non-GPP reps
/** Total approvals (incl. GPP's implicit yes) needed to pass. */
export const APPROVE_TOTAL = 5
/** Threshold on the 5-rep confirmations map: APPROVE_TOTAL − 1 (GPP auto-approves). */
export const APPROVE_THRESHOLD = APPROVE_TOTAL - 1 // = 4
/** Up to 3 proposal rounds; the 3rd failed round is an automatic no-deal. */
export const MAX_ROUNDS = 3

/**
 * Roles whose approval is MANDATORY for a given proposed contract (hard vetoes):
 *   - FLP must approve any deal that tenders money for the land (Land Price ≠ Donated).
 *   - The Governor must approve any deal that grants a tax break (Tax ≠ 0%).
 * (GPP's consent is also mandatory but is satisfied implicitly — GPP is the proposer.)
 * Returns the subset of VOTE_ROLES that must vote 'confirmed' or the deal fails.
 */
export function requiredApproverRoles(contract: Record<string, unknown>): AdkRole[] {
  const required: AdkRole[] = []
  if (contract['land_price'] !== 'No Cost, Donated') required.push('flp')
  if (contract['tax'] !== '0%') required.push('governor')
  return required
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/** Sum of the frozen-vector points for a role across the five selected options. */
export function computeDealScore(role: string, outcome: Outcome): number {
  let total = 0
  for (const issue of CONTRACT_FIELDS) {
    const opt = outcome[issue] as string
    const pts = POINTS[issue]?.[opt]?.[role as AdkRole]
    if (pts !== undefined) total += pts
  }
  return total
}

/**
 * Three-branch scoring:
 *   (3) outcome === null → no deal after 3 rounds → BATNA[role].
 *   (2) deal passed but role's rep dissented AND role ∈ {fcc, atb} → DISSENT_PENALTY[role].
 *   (1) deal passed, role approved (or a non-FCC/ATB dissenter) → computeDealScore.
 * The vote result reaches the scorer via two system fields the local submitConfirmation
 * writes onto the stored outcome: deal_passed:true and dissenting_roles:string[].
 */
export function computeRawScore(
  role: string,
  outcome: Outcome | null,
  _configData?: Record<string, unknown>,
): number {
  if (outcome === null) {
    return BATNA[role as AdkRole] ?? 0 // branch 3 — no deal
  }
  const dissenters = (outcome['dissenting_roles'] as string[] | undefined) ?? []
  if (dissenters.includes(role) && role in DISSENT_PENALTY) {
    return DISSENT_PENALTY[role as AdkRole]! // branch 2 — FCC 70 / ATB 65
  }
  return computeDealScore(role, outcome) // branch 1 — full deal-score
}

// ── GameDefinition ───────────────────────────────────────────────────────────

export const adirondacksGameDef: GameDefinition = {
  game_id: 'adirondacks',
  roles: adirondacksConfig,
  scoreSense: adirondacksScoreSense,
  composition: { gpp: 2, ala: 2, flp: 2, fcc: 2, governor: 2, atb: 2 }, // ideal 2 per role → group of 12
  // Remnant policy (Part 5): after full 12-person groups form, if the leftover holds
  // ≥1 of EVERY role, pull ONE one-per-role group of 6 (at most once); remaining
  // leftovers fold in via standard absorption (perRoleCap omitted → no cap).
  remnantGroup: { composition: { gpp: 1, ala: 1, flp: 1, fcc: 1, governor: 1, atb: 1 } },
  outcomeSchema: adirondacksSchema,
  computeRawScore,
  corsOrigins: ['https://adirondacks.mygames.live'],
  classroom: { callbackSecretId: 'adirondacks_v1' },
  // 3 proposal rounds; the local submitConfirmation turns the 3rd failure into an
  // automatic no-deal (branch 3) rather than the shared 'deadlocked' state.
  deadlockThreshold: MAX_ROUNDS,

  configFields: [
    { key: 'gpp_role_name',      kind: 'string', default: 'GPP' },
    { key: 'ala_role_name',      kind: 'string', default: 'Adirondack Logging Association' },
    { key: 'flp_role_name',      kind: 'string', default: 'Forest Legacy Program' },
    { key: 'fcc_role_name',      kind: 'string', default: 'Forest Conservation Committee' },
    { key: 'governor_role_name', kind: 'string', default: 'The Governor' },
    { key: 'atb_role_name',      kind: 'string', default: 'Adirondack Tourism Board' },
    // Per-role case brief (PDF) + scoring worksheet (xlsx). Clean slugs; the actual
    // V6 files are placed under frontend/public/role-info/ (Step D).
    { key: 'gpp_sheet_url',          kind: 'url', default: '/role-info/gpp.pdf' },
    { key: 'gpp_worksheet_url',      kind: 'url', default: '/role-info/gpp-worksheet.xlsx' },
    { key: 'ala_sheet_url',          kind: 'url', default: '/role-info/ala.pdf' },
    { key: 'ala_worksheet_url',      kind: 'url', default: '/role-info/ala-worksheet.xlsx' },
    { key: 'flp_sheet_url',          kind: 'url', default: '/role-info/flp.pdf' },
    { key: 'flp_worksheet_url',      kind: 'url', default: '/role-info/flp-worksheet.xlsx' },
    { key: 'fcc_sheet_url',          kind: 'url', default: '/role-info/fcc.pdf' },
    { key: 'fcc_worksheet_url',      kind: 'url', default: '/role-info/fcc-worksheet.xlsx' },
    { key: 'governor_sheet_url',     kind: 'url', default: '/role-info/governor.pdf' },
    { key: 'governor_worksheet_url', kind: 'url', default: '/role-info/governor-worksheet.xlsx' },
    { key: 'atb_sheet_url',          kind: 'url', default: '/role-info/atb.pdf' },
    { key: 'atb_worksheet_url',      kind: 'url', default: '/role-info/atb-worksheet.xlsx' },
  ],

  roleInfoLinks: ROLE_KEYS.map((k) => ({
    roleKey: k,
    links: [
      { key: `${k}_sheet_url`,     label: 'Role brief' },
      { key: `${k}_worksheet_url`, label: 'Scoring worksheet' },
    ],
  })),

  // ── STUB knowledge-check (TODO(KC): Elena supplies the real questions later) ──
  // Six role-ID gates (system, one per role, ungraded) so the flow runs, plus two
  // placeholder graded MC questions (role_target 'all'). Replace with real content.
  prepDefaults: [
    ...ROLE_KEYS.map((k) => {
      const label = adirondacksConfig.roles.find((r) => r.key === k)!.label
      return {
        field: `kc_gate_${k}`, type: 'mc' as const, system: true,
        category: 'knowledge_check' as const, format: 'multiple_choice' as const,
        grading: 'assigned_role' as const, role_target: k,
        prompt: 'What is your role in this negotiation?',
        placeholder: '', order: 0, hidden: false, deletable: false,
        options: adirondacksConfig.roles.map((r) => ({ value: r.key, label: r.label })),
        explanation: `You represent ${label} in the Adirondack Park easement negotiation.`,
      }
    }),
    // TODO(KC): placeholder graded questions — replace with the real Adirondacks KC.
    {
      field: 'kc_stub_threshold', type: 'mc', system: false,
      category: 'knowledge_check', format: 'multiple_choice',
      grading: 'static', correct_value: 'five_of_six', role_target: 'all',
      prompt: '[PLACEHOLDER — TODO(KC)] How many of the six parties must approve a proposal for it to pass?',
      placeholder: '', order: 10, hidden: false, deletable: false,
      options: [
        { value: 'all_six',     label: 'All six parties (unanimous).' },
        { value: 'five_of_six', label: 'At least five of the six parties.' },
        { value: 'majority',    label: 'A simple majority (four of six).' },
        { value: 'gpp_only',    label: 'Only GPP, the proposer.' },
      ],
      explanation: 'A proposal passes when at least five of the six parties approve it (and the conditional vetoers consent).',
    },
    {
      field: 'kc_stub_batna', type: 'mc', system: false,
      category: 'knowledge_check', format: 'multiple_choice',
      grading: 'static', correct_value: 'no_deal', role_target: 'all',
      prompt: '[PLACEHOLDER — TODO(KC)] When does your BATNA (no-deal floor) become your score?',
      placeholder: '', order: 11, hidden: false, deletable: false,
      options: [
        { value: 'no_deal',  label: 'When the group fails to reach a deal after three proposal rounds.' },
        { value: 'always',   label: 'Always, regardless of the negotiated outcome.' },
        { value: 'dissent',  label: 'Whenever you personally vote against a proposal.' },
        { value: 'never',    label: 'Never — the BATNA is only a reference point.' },
      ],
      explanation: 'If no proposal reaches five approvals within three rounds, every role receives its BATNA floor.',
    },
    // Ungraded prep reflection.
    {
      field: 'prep_approach', type: 'text', system: false,
      category: 'preparation', format: 'text', role_target: 'all',
      prompt: 'Which issues matter most to your party, and where can you afford to concede? Sketch your strategy for the negotiation.',
      placeholder: '', order: 20, hidden: false, deletable: true,
    },
  ],

  content: {
    infoPDFs:      {} as Record<string, { private: string; public?: string }>,
    kcQuestions:   [],
    prepQuestions: [],
    scenarioText:  {},
  },
}

// ── Frozen conformance vector (5 worked full deals × 6 roles = 30 role-scores) ─
// Computed independently from the frozen POINTS vector; every role total is 0–100.
// These are branch-1 (deal reached, all approve) scores. Branch 2 (dissent) and
// branch 3 (no deal) are asserted separately in the conformance test.

export type ConformanceCase = {
  label: string
  outcome: Outcome
  expected: Record<AdkRole, number>
}

export const CONFORMANCE_VECTOR: ConformanceCase[] = [
  {
    label: 'Deal 1 — all first options (ClearCut/Wilderness/Exceed/$50M/0%)',
    outcome: { logging: 'Clear Cut', public_use: 'Wilderness', safety: 'Exceed OSHA', land_price: '$50 million', tax: '0%' },
    expected: { governor: 66, flp: 19, fcc: 45, ala: 79, atb: 25, gpp: 51 },
  },
  {
    label: 'Deal 2 — sustainable compromise (SustRoads/Recreation/Improve/$25M/15%)',
    outcome: { logging: 'Sustainable with Roads', public_use: 'Recreation', safety: 'Improve on OSHA', land_price: '$25 million', tax: '15%' },
    expected: { governor: 72, flp: 77, fcc: 47, ala: 79, atb: 49, gpp: 63 },
  },
  {
    label: 'Deal 3 — no roads + mechanized (SustNoRoads/Mechanized/Full/$10M/25%)',
    outcome: { logging: 'Sustainable without Roads', public_use: 'Mechanized Vehicles', safety: 'Full OSHA Compliance', land_price: '$10 million', tax: '25%' },
    expected: { governor: 59, flp: 78, fcc: 55, ala: 37, atb: 84, gpp: 55 },
  },
  {
    label: 'Deal 4 — donated land, basic safety (SustRoads/Recreation/Basic/Donated/37%)',
    outcome: { logging: 'Sustainable with Roads', public_use: 'Recreation', safety: 'Basic OSHA Compliance', land_price: 'No Cost, Donated', tax: '37%' },
    expected: { governor: 29, flp: 51, fcc: 47, ala: 30, atb: 32, gpp: 59 },
  },
  {
    label: 'Deal 5 — mixed (ClearCut/Mechanized/Improve/$50M/5%)',
    outcome: { logging: 'Clear Cut', public_use: 'Mechanized Vehicles', safety: 'Improve on OSHA', land_price: '$50 million', tax: '5%' },
    expected: { governor: 79, flp: 36, fcc: 0, ala: 70, atb: 67, gpp: 59 },
  },
]
