import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { signInWithCustomToken, signOut } from 'firebase/auth'
import { auth, functions } from '../firebase'
import {
  SortableTable,
  ReportBoard,
  GameHeader,
  ExportModal,
  buildStudentTextExport,
  type SortableColumn,
  type ReportTileConfig,
  type AiTextRow,
} from '@mygames/game-ui'
import { ContractGrid, NOTES_FIELD, SchemaField, parseForm, type FormValues } from '../phases/OutcomeReporting'
import { ROLE_LABELS, FIELD_LABELS, type OutcomeSchema } from '../gameConfig'

// ── Types ─────────────────────────────────────────────────────────────────────

type ScoreBranch = 'deal' | 'dissent' | 'no_deal'

type ReportRow = {
  participant_id: string
  display_name: string
  group_number: number | null
  group_id: string | null
  role: string
  logging: string | null
  public_use: string | null
  safety: string | null
  land_price: string | null
  tax: string | null
  deal_reached: boolean
  score_branch: ScoreBranch
  batna_applied: boolean
  instructor_resolved: boolean
  raw_score: number | null
  text_answers: Record<string, string>
  notes: string | null
}

type QuestionMeta = { field: string; prompt: string; role_target: string }

function fmtScore(n: number | null): string {
  return n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function branchLabel(r: ReportRow): { text: string; color: string } {
  if (r.score_branch === 'no_deal') return { text: 'No deal · BATNA', color: '#b45309' }
  if (r.score_branch === 'dissent') return { text: 'Dissented · penalty', color: '#c026d3' }
  return { text: 'Deal', color: '#15803d' }
}

// ── Sortable columns ──────────────────────────────────────────────────────────

type SortKey =
  | 'name' | 'group' | 'role'
  | 'logging' | 'public_use' | 'safety' | 'land_price' | 'tax'
  | 'resolution' | 'raw_score' | 'notes' | 'edit'

function issueCol(key: 'logging' | 'public_use' | 'safety' | 'land_price' | 'tax'): SortableColumn<ReportRow, SortKey> {
  return {
    key, label: FIELD_LABELS[key], headerStyle: { minWidth: 110 },
    nullsLast: true, isNull: r => r[key] === null,
    tiebreak: (a, b) => a.display_name.localeCompare(b.display_name),
    render: r => r[key] ?? '—',
    compare: (a, b) => (a[key] ?? '').localeCompare(b[key] ?? ''),
  }
}

const COLUMNS: readonly SortableColumn<ReportRow, SortKey>[] = [
  {
    key: 'name', label: 'Name', headerStyle: { minWidth: 140 }, sticky: 'left',
    render: r => r.display_name,
    compare: (a, b) => a.display_name.localeCompare(b.display_name),
  },
  {
    key: 'group', label: 'Group #',
    render: r => r.group_number ?? '—',
    compare: (a, b) => (a.group_number ?? Infinity) - (b.group_number ?? Infinity),
  },
  {
    key: 'role', label: 'Role',
    render: r => ROLE_LABELS[r.role] ?? r.role,
    compare: (a, b) => a.role.localeCompare(b.role),
  },
  issueCol('logging'),
  issueCol('public_use'),
  issueCol('safety'),
  issueCol('land_price'),
  issueCol('tax'),
  {
    key: 'resolution', label: 'Resolution', headerStyle: { minWidth: 130 },
    render: r => {
      const b = branchLabel(r)
      return (
        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ color: b.color, fontWeight: 600 }}>{b.text}</span>
          {r.instructor_resolved && <span style={{ fontSize: '0.72rem', color: '#2563eb' }}>instructor-resolved</span>}
        </span>
      )
    },
    compare: (a, b) => a.score_branch.localeCompare(b.score_branch),
  },
  {
    key: 'raw_score', label: 'Raw score', nullsLast: true, isNull: r => r.raw_score === null,
    tiebreak: (a, b) => a.display_name.localeCompare(b.display_name),
    render: r => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtScore(r.raw_score)}</span>,
    compare: (a, b) => (a.raw_score ?? 0) - (b.raw_score ?? 0),
  },
  {
    key: 'notes', label: 'Notes', headerStyle: { minWidth: 80 },
    nullsLast: true, isNull: r => !r.notes || !r.notes.trim(),
    tiebreak: (a, b) => a.display_name.localeCompare(b.display_name),
    render: r => (r.notes && r.notes.trim())
      ? <span style={{ whiteSpace: 'pre-wrap', display: 'inline-block', maxWidth: 220, overflowWrap: 'anywhere' }}>{r.notes}</span>
      : '—',
    compare: (a, b) => (a.notes ?? '').localeCompare(b.notes ?? ''),
  },
]

// ── Page component ────────────────────────────────────────────────────────────

export default function Reports() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const devGameInstanceId = import.meta.env.DEV
    ? searchParams.get('_dev_game_instance_id')
    : null
  const tokenParam          = searchParams.get('token')
  const gameInstanceIdParam = searchParams.get('game_instance_id')

  const [sessionReady, setSessionReady] = useState(false)
  const [authError,    setAuthError]    = useState<string | null>(null)

  const makeLink = (base: string): string => {
    if (devGameInstanceId) return `${base}?_dev_game_instance_id=${encodeURIComponent(devGameInstanceId)}`
    if (tokenParam && gameInstanceIdParam)
      return `${base}?token=${encodeURIComponent(tokenParam)}&game_instance_id=${encodeURIComponent(gameInstanceIdParam)}`
    return base
  }

  // ── Auth bootstrap ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const establish = async () => {
      await auth.authStateReady()
      if (cancelled) return
      if (auth.currentUser) {
        const expectedUid = devGameInstanceId
          ? `instructor_${devGameInstanceId}`
          : gameInstanceIdParam ? `instructor_${gameInstanceIdParam}` : null
        if (expectedUid && auth.currentUser.uid === expectedUid) { setSessionReady(true); return }
        await signOut(auth)
        if (cancelled) return
      }
      const args = devGameInstanceId
        ? { _dev: { game_instance_id: devGameInstanceId } }
        : tokenParam ? { token: tokenParam } : null
      if (!args) { setAuthError('No launch token found.'); return }
      try {
        const fn = httpsCallable<object, { customToken: string }>(functions, 'getInstructorSession')
        const res = await fn(args)
        if (cancelled) return
        await signInWithCustomToken(auth, res.data.customToken)
        if (cancelled) return
        setSessionReady(true)
      } catch (err) {
        if (cancelled) return
        setAuthError(err instanceof Error ? err.message : 'Failed to establish session.')
      }
    }
    void establish()
    return () => { cancelled = true }
  }, [devGameInstanceId, tokenParam]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Data load ──────────────────────────────────────────────────────────────
  const [rows,      setRows]      = useState<ReportRow[] | null>(null)
  const [questions, setQuestions] = useState<QuestionMeta[]>([])
  const [schema,    setSchema]    = useState<OutcomeSchema | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!sessionReady) return
    setLoading(true)
    setError(null)
    const fn = httpsCallable<object, { ok: boolean; rows: ReportRow[]; questions: QuestionMeta[]; schema: OutcomeSchema }>(functions, 'getReportData')
    fn({}).then(r => {
      setRows(r.data.rows)
      setQuestions(r.data.questions)
      setSchema(r.data.schema)
      setLoading(false)
    }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to load report data.')
      setLoading(false)
    })
  }, [sessionReady])

  // ── Resolve-group editor (report-only: writes the group contract and recomputes
  //    each member's raw_score via updateGroupContract; never z-scores/pushes). Also
  //    the manual take-over for a stalled group — set a deal, or force no-deal → BATNA.
  //    After resolving, click "Score & Record" on the dashboard to push grades. ──
  const [editing,     setEditing]     = useState<{ groupId: string; groupNumber: number | null } | null>(null)
  const [formValues,  setFormValues]  = useState<FormValues>({})
  const [dealReached, setDealReached] = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [editError,   setEditError]   = useState<string | null>(null)

  const openEditor = (row: ReportRow) => {
    if (!row.group_id || !schema) return
    const hasDeal = schema.some(f => f.type !== 'text' && (row as Record<string, unknown>)[f.key] != null)
    const vals: FormValues = {}
    for (const f of schema) {
      const raw = (row as Record<string, unknown>)[f.key]
      vals[f.key] = raw == null ? '' : String(raw)
    }
    setFormValues(vals)
    setDealReached(hasDeal)
    setEditError(null)
    setEditing({ groupId: row.group_id, groupNumber: row.group_number })
  }

  const saveEditor = async () => {
    if (!editing || !schema) return
    let outcome: Record<string, unknown> | null = null
    if (dealReached) {
      const parsed = parseForm(formValues, schema)
      if (!parsed.ok) { setEditError(parsed.error); return }
      outcome = parsed.outcome
    }
    setSaving(true)
    setEditError(null)
    try {
      const fn = httpsCallable<
        { groupId: string; agreement_reached: boolean; outcome: Record<string, unknown> | null },
        { ok: boolean; rows: ReportRow[] }
      >(functions, 'updateGroupContract')
      const res = await fn({ groupId: editing.groupId, agreement_reached: dealReached, outcome })
      const updated = res.data.rows
      setRows(prev => prev ? prev.map(r => updated.find(u => u.participant_id === r.participant_id) ?? r) : prev)
      setEditing(null)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save contract.')
    } finally {
      setSaving(false)
    }
  }

  // ── Modal state ────────────────────────────────────────────────────────────
  const [contractOpen, setContractOpen] = useState(false)
  const [activeExport, setActiveExport] = useState<{ title: string; text: string } | null>(null)

  const finalized = rows?.length ?? 0

  const tiles: ReportTileConfig[] = [
    {
      id: 'contract-outcomes',
      title: 'Contract Outcomes — per participant',
      preview: rows == null
        ? <span style={{ color: '#888', fontSize: '0.85rem' }}>{loading ? 'Loading…' : 'No data'}</span>
        : <span style={{ fontSize: '0.9rem', color: '#555' }}>
            {finalized} participant{finalized !== 1 ? 's' : ''} finalized
          </span>,
      onOpen: () => setContractOpen(true),
      disabled: !rows || rows.length === 0,
      actionLabel: 'Open ↗',
    },
    ...questions.map(q => {
      const roleLabel = q.role_target === 'all' ? 'All roles' : (ROLE_LABELS[q.role_target] ?? q.role_target)
      const tileTitle = `${roleLabel}: ${q.prompt}`
      const qRows: AiTextRow[] = (rows ?? [])
        .filter(r => (q.role_target === 'all' || r.role === q.role_target) && r.text_answers[q.field])
        .map(r => ({ name: r.display_name, raw_score: r.raw_score, answer: r.text_answers[q.field] }))
      const text = buildStudentTextExport(tileTitle, qRows)
      return {
        id: q.field,
        title: tileTitle,
        preview: qRows.length === 0
          ? <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No responses yet.</span>
          : <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111' }}>
              {qRows.length} response{qRows.length !== 1 ? 's' : ''}
            </span>,
        onOpen: () => setActiveExport({ title: tileTitle, text }),
        disabled: !rows,
        actionLabel: 'Open ↗',
      } satisfies ReportTileConfig
    }),
  ]

  if (authError) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: '#c00' }}>{authError}</p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <GameHeader />

      <div style={{ padding: '1rem 1.5rem 0.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button
          onClick={() => navigate(makeLink('/dashboard'))}
          style={{ background: 'none', border: '1px solid #ccc', borderRadius: 4, padding: '0.3rem 0.8rem', cursor: 'pointer', fontSize: '0.85rem' }}
        >
          ← Dashboard
        </button>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Reports — Adirondacks</h2>
      </div>

      <main style={{ flex: 1, padding: '1rem 1.5rem' }}>
        {error && <p style={{ color: '#c00', marginBottom: '1rem' }}>{error}</p>}
        <ReportBoard tiles={tiles} />
      </main>

      {contractOpen && (
        <div
          onClick={() => setContractOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '3rem 1rem', zIndex: 1000, overflowY: 'auto',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
              width: '100%', maxWidth: 'min(1200px, calc(100vw - 2rem))', minWidth: 0,
              boxSizing: 'border-box', maxHeight: 'calc(100vh - 6rem)', overflowY: 'auto',
              padding: '1.25rem 1.5rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Contract Outcomes — per participant</h3>
              <button
                onClick={() => setContractOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#666' }}
              >
                ✕
              </button>
            </div>
            <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 14rem)', border: '1px solid #ddd', borderRadius: 6 }}>
              <SortableTable<ReportRow, SortKey>
                rows={rows ?? []}
                columns={[
                  ...COLUMNS,
                  {
                    key: 'edit', label: '', headerStyle: { cursor: 'default' }, sticky: 'right',
                    render: r => (
                      <button
                        onClick={() => openEditor(r)}
                        disabled={!r.group_id || !schema}
                        style={{ background: 'none', border: '1px solid #ccc', borderRadius: 4, padding: '0.2rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                      >
                        Resolve group
                      </button>
                    ),
                    compare: () => 0,
                  },
                ]}
                getRowKey={r => r.participant_id}
                initialSortKey="group"
                roleLabels={ROLE_LABELS}
                getRowRole={r => r.role}
                emptyMessage="No finalized participants yet."
                wrapHeaders
              />
            </div>
          </div>
        </div>
      )}

      {editing && schema && (
        <div
          onClick={() => !saving && setEditing(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '3rem 1rem', zIndex: 1100, overflowY: 'auto',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.3)', width: '100%', maxWidth: 480, padding: '1.25rem 1.5rem' }}
          >
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 600 }}>
              Resolve group {editing.groupNumber ?? '—'}
            </h3>
            <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: '#666', lineHeight: 1.5 }}>
              Set this group's outcome directly (e.g. a stuck or absent representative). Applies to
              the whole group; every member's raw score recomputes. Click <strong>Score &amp; Record</strong>
              afterward to push grades. Groups that finish 3 failed rounds already auto-resolve to no-deal.
            </p>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={dealReached}
                onChange={e => { setDealReached(e.target.checked); setEditError(null) }}
                disabled={saving}
                style={{ width: 18, height: 18 }}
              />
              A deal was reached
            </label>
            <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#666', lineHeight: 1.5 }}>
              Check and enter the five issues for a deal. Uncheck to force <strong>no deal</strong> —
              every role scores its BATNA floor.
            </p>

            <div style={{ opacity: dealReached ? 1 : 0.5 }}>
              <ContractGrid
                formValues={formValues}
                onChange={(key, v) => { setFormValues(prev => ({ ...prev, [key]: v })); setEditError(null) }}
                disabled={saving || !dealReached}
              />
              <SchemaField
                field={NOTES_FIELD}
                value={(formValues['notes'] as string) ?? ''}
                onChange={v => { setFormValues(prev => ({ ...prev, notes: v })); setEditError(null) }}
                disabled={saving || !dealReached}
              />
            </div>

            {editError && <p style={{ color: '#c00', margin: '0 0 0.75rem', fontSize: '0.9rem' }}>{editError}</p>}

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button onClick={saveEditor} disabled={saving} style={{ padding: '0.4rem 1rem', cursor: 'pointer' }}>
                {saving ? 'Saving…' : 'Save resolution'}
              </button>
              <button onClick={() => setEditing(null)} disabled={saving} style={{ padding: '0.4rem 1rem', background: 'none', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {activeExport && (
        <ExportModal
          title={activeExport.title}
          text={activeExport.text}
          onClose={() => setActiveExport(null)}
        />
      )}
    </div>
  )
}
