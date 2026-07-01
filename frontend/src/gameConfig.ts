import { type RoleConfig } from '@mygames/game-engine/roles'
import { type OutcomeField, type OutcomeSchema } from '@mygames/game-engine/outcome'

export type { RoleConfig, OutcomeField, OutcomeSchema }

// Mirrors functions/src/gameDefinition.ts — GPP is roles[0] (the proposer/lead).
export const adirondacksConfig: RoleConfig = {
  roles: [
    { key: 'gpp',      label: 'GPP',                            short: 'GPP' },
    { key: 'ala',      label: 'Adirondack Logging Association', short: 'ALA' },
    { key: 'flp',      label: 'Forest Legacy Program',          short: 'FLP' },
    { key: 'fcc',      label: 'Forest Conservation Committee',  short: 'FCC' },
    { key: 'governor', label: 'The Governor',                   short: 'Gov' },
    { key: 'atb',      label: 'Adirondack Tourism Board',       short: 'ATB' },
  ],
}

// The five single-select issues + optional Notes. Enum values ARE the display labels
// (tax shown as percentages). Mirrors functions/src/gameDefinition.ts adirondacksSchema.
export const adirondacksSchema: OutcomeSchema = [
  { key: 'logging',    type: 'enum', options: ['Clear Cut', 'Sustainable with Roads', 'Sustainable without Roads'] },
  { key: 'public_use', type: 'enum', options: ['Wilderness', 'Recreation', 'Mechanized Vehicles'] },
  { key: 'safety',     type: 'enum', options: ['Exceed OSHA', 'Improve on OSHA', 'Full OSHA Compliance', 'Basic OSHA Compliance'] },
  { key: 'land_price', type: 'enum', options: ['$50 million', '$25 million', '$10 million', 'No Cost, Donated'] },
  { key: 'tax',        type: 'enum', options: ['0%', '5%', '15%', '25%', '37%'] },
  { key: 'notes',      type: 'text' },
]

export const FIELD_LABELS: Readonly<Record<string, string>> = {
  logging:    'Type of Logging Allowed',
  public_use: 'Public Use',
  safety:     'Logger Safety',
  land_price: 'Land Price',
  tax:        'Tax Breaks',
  notes:      'Notes',
}

/** The five contract issue keys, in display order (no notes). */
export const CONTRACT_FIELDS = ['logging', 'public_use', 'safety', 'land_price', 'tax'] as const

export const ROLE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  adirondacksConfig.roles.map(r => [r.key, r.label]),
)

/** The five role representatives that vote (GPP proposes and auto-approves as lead). */
export const VOTE_ROLES = ['ala', 'flp', 'fcc', 'governor', 'atb'] as const
export const APPROVE_TOTAL = 5   // ≥5 of 6 parties (incl. GPP) must approve
export const MAX_ROUNDS = 3

/**
 * Conditional vetoers for a proposed contract — mirrors the server's requiredApproverRoles.
 * FLP must approve if the land tenders money; the Governor if any tax break is granted.
 * Used purely to make the rules legible to students; the server is authoritative.
 */
export function requiredApproverRoles(contract: Record<string, unknown>): string[] {
  const required: string[] = []
  if (contract['land_price'] !== 'No Cost, Donated') required.push('flp')
  if (contract['tax'] !== '0%') required.push('governor')
  return required
}

export function formatField(field: OutcomeField, value: unknown): string {
  if (field.type === 'integer') return (value as number).toLocaleString('en-US')
  if (field.type === 'decimal') return (value as number).toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (field.type === 'enum')    return value as string
  if (field.type === 'boolean') return (value as boolean) ? 'Yes' : 'No'
  return String(value)
}
