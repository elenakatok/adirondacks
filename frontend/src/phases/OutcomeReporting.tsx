import { useEffect, useRef, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { submitLeadOutcome, submitConfirmation, type CallArgs } from '../api'
import {
  adirondacksConfig,
  adirondacksSchema,
  CONTRACT_FIELDS,
  FIELD_LABELS,
  ROLE_LABELS,
  VOTE_ROLES,
  APPROVE_TOTAL,
  MAX_ROUNDS,
  formatField,
  requiredApproverRoles,
  type OutcomeField as FieldDef,
  type OutcomeSchema,
} from '../gameConfig'

// ── Types ─────────────────────────────────────────────────────────────────────

type Confirmation = 'pending' | 'confirmed' | 'rejected'
type OutcomeFields = Record<string, unknown>

type GroupData = {
  status: string
  lead_outcome: OutcomeFields | null
  lead_reported_at: object | null
  confirmations: Record<string, Confirmation>
  lead_participant_id: string
  reset_count: number | undefined
  agreement_reached: boolean | null
  outcome: OutcomeFields | null
} & Record<string, unknown> // <role>_participants arrays

type Props = {
  groupId: string
  participantId: string
  gameInstanceId: string
  isLead: boolean
  args: CallArgs
  onComplete: () => void
}

const ROLE_KEYS = adirondacksConfig.roles.map(r => r.key)

function participantsFor(g: GroupData, roleKey: string): string[] {
  return (g[`${roleKey}_participants`] as string[] | undefined) ?? []
}

/** Which of the six role arrays contains this participant. */
function deriveRoleKey(g: GroupData, participantId: string): string {
  for (const key of ROLE_KEYS) if (participantsFor(g, key).includes(participantId)) return key
  return ROLE_KEYS[0]
}

/** The representative of a role = first participant in its (shuffle-randomised) array. */
function repFor(g: GroupData, roleKey: string): string | undefined {
  return participantsFor(g, roleKey)[0]
}

// ── Schema-driven form (five dropdowns + notes) ────────────────────────────────

export type FormValues = Record<string, string | boolean>

function defaultFormValues(): FormValues {
  const out: FormValues = {}
  for (const field of adirondacksSchema) out[field.key] = ''
  return out
}

type ParseOk  = { ok: true;  outcome: OutcomeFields }
type ParseErr = { ok: false; error: string }

export function parseForm(values: FormValues, schema: OutcomeSchema = adirondacksSchema): ParseOk | ParseErr {
  const outcome: OutcomeFields = {}
  for (const field of schema) {
    const lbl = FIELD_LABELS[field.key] ?? field.key
    if (field.type === 'enum') {
      const v = values[field.key] as string
      if (!field.options.includes(v)) return { ok: false, error: `${lbl} is required — choose an option.` }
      outcome[field.key] = v
    } else if (field.type === 'text') {
      outcome[field.key] = (values[field.key] as string) ?? ''
    } else {
      outcome[field.key] = values[field.key]
    }
  }
  return { ok: true, outcome }
}

export function SchemaField({
  field, value, onChange, disabled,
}: {
  field: FieldDef
  value: string | boolean
  onChange: (v: string) => void
  disabled: boolean
}) {
  const lbl = FIELD_LABELS[field.key] ?? field.key
  if (field.type === 'enum') {
    return (
      <div style={fieldRowStyle}>
        <label style={fieldLabelStyle}>{lbl}</label>
        <select value={value as string} onChange={e => onChange(e.target.value)} disabled={disabled} style={inputStyle}>
          <option value="" disabled>— select —</option>
          {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>
    )
  }
  // text (notes)
  return (
    <div style={fieldRowStyle}>
      <label style={fieldLabelStyle}>Notes</label>
      <textarea
        value={value as string}
        placeholder="Optional — any terms not captured above"
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        rows={3}
        style={{ ...inputStyle, maxWidth: '100%', resize: 'vertical' as const }}
      />
    </div>
  )
}

export const NOTES_FIELD = adirondacksSchema.find(f => f.key === 'notes') as FieldDef

/** The five issue dropdowns — shared by the student propose form and the Reports editor. */
export function ContractGrid({
  formValues, onChange, disabled,
}: {
  formValues: FormValues
  onChange: (key: string, v: string) => void
  disabled: boolean
}) {
  return (
    <div>
      {CONTRACT_FIELDS.map(key => {
        const field = adirondacksSchema.find(f => f.key === key) as FieldDef
        return (
          <SchemaField
            key={key}
            field={field}
            value={(formValues[key] as string) ?? ''}
            onChange={v => onChange(key, v)}
            disabled={disabled}
          />
        )
      })}
    </div>
  )
}

// ── Outcome / vote summary cards ───────────────────────────────────────────────

function OutcomeCard({ outcome }: { outcome: OutcomeFields }) {
  return (
    <div style={outcomeCardStyle}>
      {adirondacksSchema.map(field => {
        const v = outcome[field.key]
        if (field.type === 'text' && (v == null || v === '')) return null
        return (
          <div key={field.key} style={outcomeRowStyle}>
            <span style={outcomeLabelStyle}>{FIELD_LABELS[field.key] ?? field.key}</span>
            <span>{field.type === 'text' ? String(v) : formatField(field, v)}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Rules banner — makes the 5-of-6 + conditional vetoes legible; highlights ones in force. */
function RulesBanner({ contract }: { contract: OutcomeFields | null }) {
  const required = contract ? requiredApproverRoles(contract) : []
  return (
    <div style={rulesBannerStyle}>
      <strong>How a deal passes:</strong> at least {APPROVE_TOTAL} of the 6 parties must approve,
      and <strong>GPP</strong> must approve. In addition:
      <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
        <li style={{ opacity: required.includes('flp') ? 1 : 0.5 }}>
          <strong>FLP</strong> must approve if the land is not donated
          {contract && (required.includes('flp') ? ' — required for this proposal' : ' — not required (land is donated)')}.
        </li>
        <li style={{ opacity: required.includes('governor') ? 1 : 0.5 }}>
          <strong>The Governor</strong> must approve if there is any tax break
          {contract && (required.includes('governor') ? ' — required for this proposal' : ' — not required (0% tax)')}.
        </li>
      </ul>
    </div>
  )
}

/** Per-role vote tally among the 5 representatives (GPP auto-approves as proposer). */
function VoteTally({ g }: { g: GroupData }) {
  const rows = VOTE_ROLES.map(role => {
    const rep = repFor(g, role)
    const vote = rep ? (g.confirmations?.[rep] ?? 'pending') : 'pending'
    return { role, vote }
  })
  const confirmed = rows.filter(r => r.vote === 'confirmed').length
  const total = confirmed + 1 // + GPP's implicit approval
  return (
    <div style={{ marginTop: '0.5rem' }}>
      <p style={{ color: '#555', margin: '0 0 0.4rem' }}>
        Approvals: <strong>{total} of 6</strong> (GPP approves as proposer). Need {APPROVE_TOTAL}.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'max-content max-content', gap: '0.2rem 1rem' }}>
        <div style={{ fontWeight: 700 }}>GPP</div><div style={{ color: '#0a0' }}>✓ approves (proposer)</div>
        {rows.map(({ role, vote }) => (
          <VoteRow key={role} label={ROLE_LABELS[role]} vote={vote} />
        ))}
      </div>
    </div>
  )
}

function VoteRow({ label, vote }: { label: string; vote: Confirmation }) {
  const txt = vote === 'confirmed' ? '✓ approved' : vote === 'rejected' ? '✕ rejected' : '… deciding'
  const color = vote === 'confirmed' ? '#0a0' : vote === 'rejected' ? '#c00' : '#888'
  return <><div style={{ fontWeight: 600 }}>{label}</div><div style={{ color }}>{txt}</div></>
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function OutcomeReporting({
  groupId, participantId, gameInstanceId, isLead, args, onComplete,
}: Props) {
  const [groupData,   setGroupData]   = useState<GroupData | null>(null)
  const [formValues,  setFormValues]  = useState<FormValues>(defaultFormValues)
  const [pendingDeal, setPendingDeal] = useState<OutcomeFields | null>(null)
  const [submitting,  setSubmitting]  = useState(false)
  const [formError,   setFormError]   = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const calledComplete = useRef(false)
  const onCompleteRef  = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    return onSnapshot(
      doc(db, 'game_instances', gameInstanceId, 'groups', groupId),
      snap => {
        if (!snap.exists()) return
        const d = snap.data() as GroupData
        setGroupData(d)
        if (d.status === 'completed' && !calledComplete.current) {
          calledComplete.current = true
          onCompleteRef.current()
        }
        // New round (proposal cleared) → reset the local form.
        if (d.lead_reported_at == null && d.status === 'reporting') {
          setFormValues(defaultFormValues())
          setFormError(null); setActionError(null); setPendingDeal(null)
        }
      },
    )
  }, [groupId, gameInstanceId])

  const withSubmit = (fn: () => Promise<unknown>) => {
    setSubmitting(true); setActionError(null)
    fn()
      .catch((err: unknown) => setActionError(err instanceof Error ? err.message : 'Something went wrong.'))
      .finally(() => setSubmitting(false))
  }

  const handleFieldChange = (key: string, v: string) => {
    setFormValues(prev => ({ ...prev, [key]: v })); setFormError(null)
  }
  const handleSubmitForm = () => {
    const result = parseForm(formValues)
    if (!result.ok) { setFormError(result.error); return }
    setPendingDeal(result.outcome); setFormError(null)
  }
  const handleConfirmProposal = () => {
    const outcome = pendingDeal; setPendingDeal(null)
    withSubmit(() => submitLeadOutcome(args, outcome))
  }
  const handleApprove = () => withSubmit(() => submitConfirmation(args, true))
  const handleReject  = () => withSubmit(() => submitConfirmation(args, false))

  if (!groupData) return <main style={mainStyle}><p>Loading…</p></main>

  const { status, lead_outcome, lead_reported_at, confirmations, outcome } = groupData
  const resetCount = groupData.reset_count ?? 0
  const roundNum = Math.min(resetCount + 1, MAX_ROUNDS)

  const roleKey   = deriveRoleKey(groupData, participantId)
  const roleLabel = ROLE_LABELS[roleKey] ?? roleKey
  const isRep     = repFor(groupData, roleKey) === participantId
  const isObserver = !isRep && !isLead

  // ── Terminal: completed (deal / no-deal) ─────────────────────────────────────
  if (status === 'completed') {
    const dealReached = groupData.agreement_reached === true && outcome != null
    const dissenters = (outcome?.['dissenting_roles'] as string[] | undefined) ?? []
    return (
      <main style={mainStyle}>
        <p style={subtitleStyle}>You are {roleLabel}{isObserver ? ' (observer)' : ''}</p>
        <h1 style={h1Style}>{dealReached ? 'Deal reached' : 'No deal'}</h1>
        {dealReached ? (
          <>
            <OutcomeCard outcome={outcome!} />
            {dissenters.length > 0 && (
              <p style={{ color: '#555' }}>
                Voted against: {dissenters.map(r => ROLE_LABELS[r] ?? r).join(', ')}.
              </p>
            )}
          </>
        ) : (
          <p style={{ fontSize: '1.05rem', color: '#555', lineHeight: 1.6 }}>
            Your group did not reach a deal in {MAX_ROUNDS} rounds. Every party receives its
            no-deal outcome (BATNA).
          </p>
        )}
      </main>
    )
  }

  const proposalOut = lead_reported_at != null

  // ── GPP lead (proposer) ──────────────────────────────────────────────────────
  if (isLead) {
    if (pendingDeal != null) {
      return (
        <main style={mainStyle}>
          <p style={subtitleStyle}>You are {roleLabel} — round {roundNum} of {MAX_ROUNDS}</p>
          <h1 style={h1Style}>Review your proposal</h1>
          <OutcomeCard outcome={pendingDeal} />
          <RulesBanner contract={pendingDeal} />
          {actionError && <p style={errorStyle}>{actionError}</p>}
          <div style={btnRowStyle}>
            <button onClick={handleConfirmProposal} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Put it to a vote'}
            </button>
            <button onClick={() => setPendingDeal(null)} disabled={submitting} style={ghostBtnStyle}>
              Go back
            </button>
          </div>
        </main>
      )
    }
    if (proposalOut) {
      return (
        <main style={mainStyle}>
          <p style={subtitleStyle}>You are {roleLabel} — round {roundNum} of {MAX_ROUNDS}</p>
          <h1 style={h1Style}>Waiting for the parties to vote</h1>
          {lead_outcome && <OutcomeCard outcome={lead_outcome} />}
          <VoteTally g={groupData} />
          {actionError && <p style={errorStyle}>{actionError}</p>}
        </main>
      )
    }
    return (
      <main style={mainStyle}>
        <p style={subtitleStyle}>You are {roleLabel} (GPP proposes) — round {roundNum} of {MAX_ROUNDS}</p>
        <h1 style={h1Style}>Propose a contract</h1>
        {resetCount > 0 && (
          <div style={resetBannerStyle}>
            The last proposal did not pass ({resetCount} of {MAX_ROUNDS} rounds used). Revise and
            re-propose. If round {MAX_ROUNDS} fails, the group is a no-deal.
          </div>
        )}
        <RulesBanner contract={null} />
        <div style={{ margin: '1rem 0' }}>
          <ContractGrid formValues={formValues} onChange={handleFieldChange} disabled={submitting} />
          <SchemaField field={NOTES_FIELD} value={(formValues['notes'] as string) ?? ''} onChange={v => handleFieldChange('notes', v)} disabled={submitting} />
        </div>
        {formError && <p style={errorStyle}>{formError}</p>}
        <div style={btnRowStyle}>
          <button onClick={handleSubmitForm} disabled={submitting}>Review &amp; put to a vote</button>
        </div>
      </main>
    )
  }

  // ── Non-GPP roles: waiting for a proposal ────────────────────────────────────
  if (!proposalOut) {
    return (
      <main style={mainStyle}>
        <p style={subtitleStyle}>You are {roleLabel}{isObserver ? ' (observer)' : ''} — round {roundNum} of {MAX_ROUNDS}</p>
        <h1 style={h1Style}>Waiting for GPP’s proposal</h1>
        <p style={{ fontSize: '1.05rem', color: '#555', lineHeight: 1.6 }}>
          {resetCount > 0
            ? 'The last proposal did not pass. GPP is revising it.'
            : 'GPP is preparing a proposed contract. Stay on this page.'}
        </p>
      </main>
    )
  }

  // ── Non-GPP representative: cast the role's vote ─────────────────────────────
  if (isRep) {
    const myVote = confirmations?.[participantId]
    if (myVote === 'pending') {
      return (
        <main style={mainStyle}>
          <p style={subtitleStyle}>You are {roleLabel}’s representative — round {roundNum} of {MAX_ROUNDS}</p>
          <h1 style={h1Style}>Vote on GPP’s proposal</h1>
          {lead_outcome && <OutcomeCard outcome={lead_outcome} />}
          <RulesBanner contract={lead_outcome} />
          {actionError && <p style={errorStyle}>{actionError}</p>}
          <div style={btnRowStyle}>
            <button onClick={handleApprove} disabled={submitting}>{submitting ? '…' : 'Approve'}</button>
            <button onClick={handleReject} disabled={submitting} style={ghostBtnStyle}>Reject</button>
          </div>
        </main>
      )
    }
    return (
      <main style={mainStyle}>
        <p style={subtitleStyle}>You are {roleLabel}’s representative — round {roundNum} of {MAX_ROUNDS}</p>
        <h1 style={h1Style}>Vote recorded ({myVote === 'confirmed' ? 'approved' : 'rejected'})</h1>
        {lead_outcome && <OutcomeCard outcome={lead_outcome} />}
        <VoteTally g={groupData} />
      </main>
    )
  }

  // ── Observer (non-representative student of a role) ──────────────────────────
  return (
    <main style={mainStyle}>
      <p style={subtitleStyle}>You are {roleLabel} (observer) — round {roundNum} of {MAX_ROUNDS}</p>
      <h1 style={h1Style}>Your representative is voting</h1>
      <p style={{ color: '#555', marginBottom: '1rem' }}>
        Each role casts one vote through its representative. You can watch the proposal and the
        result, but only your role’s representative votes.
      </p>
      {lead_outcome && <OutcomeCard outcome={lead_outcome} />}
      <VoteTally g={groupData} />
    </main>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const mainStyle = { padding: '2rem', maxWidth: '640px', margin: '0 auto', fontFamily: 'sans-serif' }
const h1Style = { marginTop: 0 }
const subtitleStyle = { color: '#555', marginTop: 0, marginBottom: '1.25rem' }
const errorStyle = { color: '#c00', marginBottom: '0.75rem' }
const resetBannerStyle = { color: '#8a4b00', background: '#fff7ed', border: '1px solid #fed7aa', padding: '0.6rem 0.8rem', borderRadius: 4, marginBottom: '1rem', fontSize: '0.95rem', lineHeight: 1.5 }
const rulesBannerStyle = { background: '#f6f8fa', border: '1px solid #d0d7de', borderRadius: 6, padding: '0.7rem 0.9rem', margin: '1rem 0', fontSize: '0.9rem', color: '#444', lineHeight: 1.5 }
const btnRowStyle = { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' as const, alignItems: 'center' }
const ghostBtnStyle = { background: 'none', border: '1px solid #ccc' }
const outcomeCardStyle = { background: '#f0f7ff', border: '1px solid #b3d4f5', borderRadius: 4, padding: '0.75rem 1rem', marginBottom: '1rem' }
const outcomeRowStyle = { display: 'flex', justifyContent: 'space-between', padding: '0.2rem 0', gap: '1rem' }
const outcomeLabelStyle = { color: '#555', marginRight: '1rem' }
const fieldRowStyle = { display: 'flex', flexDirection: 'column' as const, gap: '0.25rem', marginBottom: '1rem' }
const fieldLabelStyle = { fontSize: '0.9rem', fontWeight: 600, color: '#333' }
const inputStyle = { fontSize: '1rem', padding: '0.4rem 0.6rem', border: '1px solid #ccc', borderRadius: 4, maxWidth: '20rem' }
