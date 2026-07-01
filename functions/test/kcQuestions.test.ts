import { describe, it, expect } from 'vitest'
import { validateQuestionSemantics, validateKCGate, parsePrepTextQuestions } from '@mygames/game-server'
import { adirondacksGameDef, ROLE_KEYS } from '../src/gameDefinition'

// Adirondacks KC (Adirondacks_KC_Questions_v1.md): 6 role gates + 7 SHARED graded MC
// (denominator 7, role_target 'all') + 1 ungraded reflection.
const ROLES = adirondacksGameDef.roles.roles.map(r => r.key)
const questions = adirondacksGameDef.prepDefaults!

describe('Adirondacks prepDefaults — structural integrity', () => {
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

describe('Adirondacks prepDefaults — gates', () => {
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

describe('Adirondacks prepDefaults — graded MC (shared, denominator 7)', () => {
  const graded = questions.filter(q => q.grading === 'static')

  it('exactly 7 graded MC questions, all shared across roles (role_target all)', () => {
    expect(graded).toHaveLength(7)
    for (const q of graded) {
      expect(q.role_target).toBe('all')
      expect(q.system).toBe(false)
      expect(q.deletable).toBe(false)
    }
  })

  it('each graded question has a correct_value matching one of its options + a non-empty explanation', () => {
    for (const q of graded) {
      const vals = (q.options ?? []).map(o => o.value)
      expect(vals).toContain(q.correct_value)
      expect(typeof q.explanation).toBe('string')
      expect(q.explanation!.length).toBeGreaterThan(0)
    }
  })

  it('no explanation references a positional label (shuffle-safe)', () => {
    const positional = /\b(option [a-e]|choice [a-e]|answer [a-e]|\([a-e]\)|first option|second option|third option|fourth option|the answer is [a-e])\b/i
    for (const q of graded) {
      if (q.explanation) expect(q.explanation).not.toMatch(positional)
    }
  })
})

describe('Adirondacks prepDefaults — reflection', () => {
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
