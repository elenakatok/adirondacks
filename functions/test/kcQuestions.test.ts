import { describe, it, expect } from 'vitest'
import { validateQuestionSemantics, validateKCGate, parsePrepTextQuestions } from '@mygames/game-server'
import { adirondacksGameDef, ROLE_KEYS } from '../src/gameDefinition'

// NOTE: the Adirondacks KC is a STUB (TODO(KC)) — 6 role gates + 2 placeholder graded
// MC + 1 reflection. These tests lock the STRUCTURE so the flow runs; replace the
// graded-count expectations when Elena supplies the real KC questions.
const ROLES = adirondacksGameDef.roles.roles.map(r => r.key)
const questions = adirondacksGameDef.prepDefaults!

describe('Adirondacks prepDefaults (STUB) — structural integrity', () => {
  it('parses as valid PrepTextQuestion[] (no type/field errors)', () => {
    expect(parsePrepTextQuestions(questions)).not.toBeNull()
  })

  it('passes validateQuestionSemantics', () => {
    expect(validateQuestionSemantics(questions)).toBeNull()
  })

  it('passes validateKCGate for all six roles', () => {
    expect(validateKCGate(ROLES, questions)).toBeNull()
  })

  it('has no duplicate field names', () => {
    const fields = questions.map(q => q.field)
    expect(new Set(fields).size).toBe(fields.length)
  })
})

describe('Adirondacks prepDefaults (STUB) — gates', () => {
  const gates = questions.filter(q => q.grading === 'assigned_role')

  it('one gate per role (6), system:true, deletable:false, no correct_value, options = all 6 roles', () => {
    expect(gates).toHaveLength(6)
    const targets = new Set(gates.map(g => g.role_target))
    for (const r of ROLE_KEYS) expect(targets.has(r)).toBe(true)
    for (const g of gates) {
      expect(g.system).toBe(true)
      expect(g.deletable).toBe(false)
      expect(g.correct_value).toBeUndefined()
      const vals = (g.options ?? []).map(o => o.value)
      for (const r of ROLE_KEYS) expect(vals).toContain(r)
    }
  })
})

describe('Adirondacks prepDefaults (STUB) — graded MC placeholders', () => {
  const graded = questions.filter(q => q.grading === 'static')

  it('graded questions target all, have a valid correct_value + explanation', () => {
    expect(graded.length).toBeGreaterThanOrEqual(1)
    for (const q of graded) {
      expect(q.role_target).toBe('all')
      const vals = (q.options ?? []).map(o => o.value)
      expect(vals).toContain(q.correct_value)
      expect(typeof q.explanation).toBe('string')
      expect(q.explanation!.length).toBeGreaterThan(0)
    }
  })
})

describe('Adirondacks prepDefaults (STUB) — reflection', () => {
  const reflect = questions.filter(q => q.category === 'preparation')
  it('reflection questions are text, deletable, ungraded', () => {
    for (const q of reflect) {
      expect(q.format).toBe('text')
      expect(q.deletable).toBe(true)
      expect(q.grading).toBeUndefined()
      expect(q.correct_value).toBeUndefined()
    }
  })
})
