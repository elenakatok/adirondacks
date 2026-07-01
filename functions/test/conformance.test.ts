import { describe, it, expect } from 'vitest'
import {
  computeRawScore,
  computeDealScore,
  CONFORMANCE_VECTOR,
  POINTS,
  BATNA,
  DISSENT_PENALTY,
  ROLE_KEYS,
  requiredApproverRoles,
} from '../src/gameDefinition'

// ── Step C gate: the engine must reproduce all 5 worked deals exactly (30/30) ──
describe('Adirondacks scoring conformance — 5 worked deals × 6 roles', () => {
  for (const c of CONFORMANCE_VECTOR) {
    it(c.label, () => {
      for (const role of ROLE_KEYS) {
        expect(computeRawScore(role, c.outcome)).toBe(c.expected[role])
      }
    })
  }

  it('all 30 role-scores lie within 0..100', () => {
    for (const c of CONFORMANCE_VECTOR) {
      for (const role of ROLE_KEYS) {
        const s = c.expected[role]
        expect(s).toBeGreaterThanOrEqual(0)
        expect(s).toBeLessThanOrEqual(100)
      }
    }
  })
})

// ── Branch 3: no deal → BATNA for every role ─────────────────────────────────
describe('branch 3 — no deal (null outcome) → BATNA floor', () => {
  it('each role gets its BATNA', () => {
    expect(computeRawScore('gpp', null)).toBe(45)
    expect(computeRawScore('governor', null)).toBe(45)
    expect(computeRawScore('flp', null)).toBe(65)
    expect(computeRawScore('ala', null)).toBe(50)
    expect(computeRawScore('fcc', null)).toBe(75)
    expect(computeRawScore('atb', null)).toBe(85)
    // sanity: the constant table matches
    expect(BATNA).toEqual({ gpp: 45, governor: 45, flp: 65, ala: 50, fcc: 75, atb: 85 })
  })
})

// ── Branch 2: passed deal but a role's rep dissented ─────────────────────────
describe('branch 2 — dissent in a passed deal', () => {
  // Deal 2's contract; imagine it passed 5-of-6 with FCC dissenting.
  const contract = CONFORMANCE_VECTOR[1].outcome

  it('FCC dissenter → 70 (not its 47 deal-score)', () => {
    const outcome = { ...contract, deal_passed: true, dissenting_roles: ['fcc'] }
    expect(computeRawScore('fcc', outcome)).toBe(70)
    expect(DISSENT_PENALTY.fcc).toBe(70)
    // everyone else still gets their computed deal-score
    expect(computeRawScore('gpp', outcome)).toBe(CONFORMANCE_VECTOR[1].expected.gpp)
    expect(computeRawScore('governor', outcome)).toBe(CONFORMANCE_VECTOR[1].expected.governor)
  })

  it('ATB dissenter → 65 (not its deal-score)', () => {
    const outcome = { ...contract, deal_passed: true, dissenting_roles: ['atb'] }
    expect(computeRawScore('atb', outcome)).toBe(65)
    expect(DISSENT_PENALTY.atb).toBe(65)
  })

  it('a dissenting non-FCC/ATB role still gets its deal-score', () => {
    // e.g. FLP dissents (only possible in a passed deal when land is donated, so FLP
    // is not a required approver). Its score is still the computed deal-score.
    const donated = { logging: 'Sustainable with Roads', public_use: 'Recreation', safety: 'Basic OSHA Compliance', land_price: 'No Cost, Donated', tax: '0%', deal_passed: true, dissenting_roles: ['flp'] }
    expect(computeRawScore('flp', donated)).toBe(computeDealScore('flp', donated))
  })
})

// ── POINTS vector self-check: every role, every SINGLE option ∈ 0..100 ────────
describe('frozen POINTS vector invariants', () => {
  it('every point value is a 0..100 integer', () => {
    for (const issue of Object.keys(POINTS)) {
      for (const opt of Object.keys(POINTS[issue])) {
        for (const role of ROLE_KEYS) {
          const v = POINTS[issue][opt][role]
          expect(Number.isInteger(v)).toBe(true)
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThanOrEqual(100)
        }
      }
    }
  })

  it('FCC scores 0 on safety, land price, and tax (only logging + public use matter to FCC)', () => {
    for (const opt of Object.keys(POINTS.safety))     expect(POINTS.safety[opt].fcc).toBe(0)
    for (const opt of Object.keys(POINTS.land_price)) expect(POINTS.land_price[opt].fcc).toBe(0)
    for (const opt of Object.keys(POINTS.tax))        expect(POINTS.tax[opt].fcc).toBe(0)
  })
})

// ── Conditional veto rules ────────────────────────────────────────────────────
describe('requiredApproverRoles — conditional vetoes', () => {
  it('no money, no tax → no conditional vetoers', () => {
    expect(requiredApproverRoles({ land_price: 'No Cost, Donated', tax: '0%' })).toEqual([])
  })
  it('land tenders money → FLP required', () => {
    expect(requiredApproverRoles({ land_price: '$25 million', tax: '0%' })).toEqual(['flp'])
  })
  it('tax break granted → Governor required', () => {
    expect(requiredApproverRoles({ land_price: 'No Cost, Donated', tax: '15%' })).toEqual(['governor'])
  })
  it('both money and tax → FLP and Governor required', () => {
    expect(requiredApproverRoles({ land_price: '$10 million', tax: '37%' })).toEqual(['flp', 'governor'])
  })
})
