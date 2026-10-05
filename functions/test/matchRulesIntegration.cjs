/* eslint-disable */
'use strict'

// Match Now — the rules every negotiation game shares (game-server ≥ v0.31.0).
// DEFINITION-DRIVEN: reads this game's roles and composition from lib/gameDefinition.js,
// so the same file runs unchanged in each game.
//
//  1. CODE = MATCHED. A student who entered the attendance code but is not connected at
//     the instant of Match Now is still matched. (Found live, Grays 2.0, 2026-10-05: one
//     phone mid-reload dropped a confirmed student and cost the class a clean grouping.)
//  2. PREVIEW writes nothing and names the not-connected student.
//  3. EXTRAS SPREAD. Leftover students go to the smallest group, not all to the first.
//     (Where a remnant group has actually formed — Adirondacks — the engine's placement stands.)
//
// Run (from the game's root, after `npm run build` in functions/):
//   firebase emulators:exec --only functions,firestore,database --project <project> \
//     "node functions/test/matchRulesIntegration.cjs"

const path = require('path')
const fs = require('fs')
const admin = require('firebase-admin')

const root = path.join(__dirname, '../..')
const PROJECT = JSON.parse(fs.readFileSync(path.join(root, '.firebaserc'), 'utf8')).projects.default
const ports = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8')).emulators
process.env.FIRESTORE_EMULATOR_HOST = `localhost:${ports.firestore.port}`
process.env.FIREBASE_DATABASE_EMULATOR_HOST = `localhost:${ports.database.port}`
const BASE = `http://localhost:${ports.functions.port}/${PROJECT}/us-central1`

const defModule = require('../lib/gameDefinition.js')
const def = Object.values(defModule).find(v => v && typeof v === 'object' && v.composition && v.roles)
const ROLES = def.roles.roles.map(r => r.key)
const COMP = def.composition
const GROUP_SIZE = ROLES.reduce((n, k) => n + (COMP[k] ?? 1), 0)

admin.initializeApp({ projectId: PROJECT })
const db = admin.firestore()
// The functions emulator may write RTDB under either namespace; cover both.
const rtdbs = [PROJECT, `${PROJECT}-default-rtdb`].map(ns =>
  admin.initializeApp({ projectId: PROJECT, databaseURL: `http://localhost:${ports.database.port}?ns=${ns}` }, ns).database())

let passed = 0, failed = 0
const ok = (label, cond, extra) => {
  if (cond) { console.log(`  [PASS] ${label}`); passed++ }
  else      { console.log(`  [FAIL] ${label}${extra !== undefined ? ` — ${extra}` : ''}`); failed++ }
}
async function post(p, body) {
  const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: body }) })
  const j = await r.json()
  if (j.result !== undefined) return j.result
  if (j.error !== undefined) return { ok: false, error: typeof j.error === 'string' ? j.error : (j.error.message ?? JSON.stringify(j.error)) }
  return j
}
/** `groups` complete groups' worth of students, plus `extra[role]` more of some roles. */
function roster(groups, extra = {}) {
  const ps = []
  for (const k of ROLES) for (let i = 0; i < groups * (COMP[k] ?? 1) + (extra[k] ?? 0); i++) ps.push({ id: `${k}${i + 1}`, role: k })
  return ps
}
async function state(gameId) {
  const inst = db.collection('game_instances').doc(gameId)
  const [gs, ps] = await Promise.all([inst.collection('groups').get(), inst.collection('participants').get()])
  return { groups: gs.docs.map(d => d.data()), participants: ps.docs.map(d => d.data()) }
}
const sizeOf = (g) => ROLES.reduce((n, k) => n + (g[`${k}_participants`] ?? []).length, 0)
const complete = (g) => ROLES.every(k => (g[`${k}_participants`] ?? []).length >= (COMP[k] ?? 1))

async function main() {
  console.log(`\n═══ ${def.game_id}: Match Now rules (${ROLES.map(k => `${COMP[k] ?? 1} ${k}`).join(' + ')}) ═══`)

  console.log('\n── 1+2. A confirmed student who is NOT connected ──')
  const a = `mr_offline_${Date.now()}`
  const ps = roster(2)
  const offline = ps[ps.length - 1].id
  await post('/seedMatchTest', { game_instance_id: a, participants: ps })
  for (const r of rtdbs) await r.ref(`presence/${a}/${offline}`).remove()

  const pv = await post('/triggerMatching', { _dev: { game_instance_id: a }, preview: true })
  ok(`preview: ${ps.length} entered the code → 2 complete groups, nobody left over`,
    pv.ok === true && pv.preview?.confirmed === ps.length && pv.preview.groups === 2 &&
    Object.values(pv.preview.extras_by_role).every(n => n === 0), JSON.stringify(pv).slice(0, 200))
  ok('preview names the not-connected student', pv.preview?.not_connected?.map(p => p.participant_id).join() === offline)
  ok('preview wrote nothing', (await state(a)).groups.length === 0)

  const m = await post('/triggerMatching', { _dev: { game_instance_id: a } })
  let st = await state(a)
  ok(`match → 2 complete groups of ${GROUP_SIZE}`, m.ok === true && st.groups.length === 2 && st.groups.every(g => complete(g) && sizeOf(g) === GROUP_SIZE), m.error)
  ok('the not-connected student is in a group', st.participants.find(p => p.participant_id === offline)?.group_id != null)
  ok('every student is in exactly one group', st.participants.every(p => st.groups.filter(g => ROLES.some(k => (g[`${k}_participants`] ?? []).includes(p.participant_id))).length === 1))

  console.log('\n── 3. Extras ──')
  const b = `mr_extras_${Date.now()}`
  const extra = { [ROLES[0]]: 1, [ROLES[1]]: 1 }
  const qs = roster(2, extra)
  await post('/seedMatchTest', { game_instance_id: b, participants: qs })
  const m2 = await post('/triggerMatching', { _dev: { game_instance_id: b } })
  st = await state(b)
  const sizes = st.groups.map(sizeOf).sort((x, y) => x - y)
  ok(`${qs.length} students (one extra ${ROLES[0]}, one extra ${ROLES[1]}) → everyone placed, every group complete`,
    m2.ok === true && st.participants.every(p => p.group_id != null) && st.groups.every(complete), `${m2.error ?? ''} sizes ${sizes}`)
  ok('every group\'s lead is one of its members', st.groups.every(g => ROLES.some(k => (g[`${k}_participants`] ?? []).includes(g.lead_participant_id))))
  // (A remnant-group game — Adirondacks — keeps the engine's placement only when a remnant
  //  group has actually FORMED; with two complete groups here, none has.)
  ok(`extras are spread: group sizes ${sizes.join(', ')} differ by at most 1`, sizes[sizes.length - 1] - sizes[0] <= 1)

  console.log(`\n═══ ${passed}/${passed + failed} checks passed ═══\n`)
  process.exit(failed === 0 ? 0 : 1)
}
main().catch(err => { console.error('FATAL', err); process.exit(1) })
