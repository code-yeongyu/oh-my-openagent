// Playbook -> rules store sync. `planPlaybookSync` is the dry run: it diffs the
// mapped playbook against the scope's stored records and returns exactly the records it would add,
// edit and revoke, without writing. `applyPlaybookSync` performs a plan, one store commit per record
// change, so re-syncing an unchanged playbook makes zero commits.
//
// Records are matched by (source, kind, gate), where `source` = `playbook:<entry key>` comes from the
// file path and heading slug, never from line numbers. Records whose `set_by` is not the importer were
// edited by a person in the gateway: they are never edited or revoked, only reported.

import { RULE_AUDIENCES, SCOPE_KEYS, type RuleRecord } from "../format"
import type { RulePatch, RulesStore, StoredRule } from "../store"
import { mapPlaybook, PLAYBOOK_IMPORTER, PLAYBOOK_SOURCE_PREFIX, type DesiredRule, type MappedPlaybook, type PlaybookMap } from "./map"
import { parsePlaybook, readPlaybook, type PlaybookProblem } from "./parse"

export interface PlannedEdit {
  readonly n: number
  readonly source: string
  readonly patch: RulePatch
  readonly record: RuleRecord
}

export interface PlannedRevoke {
  readonly n: number
  readonly source: string
  readonly record: RuleRecord
}

export interface HumanEditedRecord {
  readonly n: number
  readonly source: string
  readonly set_by: string
  /** What the sync would have done to an importer-owned record: nothing, an edit, or a revoke. */
  readonly withheld: "none" | "edit" | "revoke"
}

export interface PlaybookSyncPlan {
  readonly gateway: string
  readonly version: string | null
  readonly add: readonly DesiredRule[]
  readonly edit: readonly PlannedEdit[]
  readonly revoke: readonly PlannedRevoke[]
  readonly unchanged: readonly { readonly n: number; readonly source: string }[]
  readonly human_edited: readonly HumanEditedRecord[]
  readonly held: readonly string[]
  readonly problems: readonly PlaybookProblem[]
  readonly unused_map_keys: readonly string[]
  readonly counts: { readonly entries: number; readonly records: number }
}

export class PlaybookSyncError extends Error {
  override readonly name = "PlaybookSyncError"
}

function identity(rule: Pick<RuleRecord, "kind"> & { readonly source?: string | undefined; readonly gate?: string | null | undefined }): string {
  return `${rule.source ?? ""}\u0000${rule.kind}\u0000${rule.gate ?? ""}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "undefined"
}

function sameScope(stored: RuleRecord, desired: DesiredRule): boolean {
  const wanted: Readonly<Record<string, string | null | undefined>> = desired.scope
  return SCOPE_KEYS.every((key) => stored.scope[key] === (wanted[key] ?? null))
}

function patchFor(stored: RuleRecord, desired: DesiredRule): RulePatch {
  const want = {
    text: desired.text.trim(),
    why: desired.why,
    enforced: desired.enforced,
    params: desired.params ?? (desired.kind === "mechanical" ? {} : null),
    locked: desired.locked ?? false,
    applies_to: desired.applies_to ?? RULE_AUDIENCES,
  }
  return {
    ...(stored.text === want.text ? {} : { text: want.text }),
    ...(stored.why === want.why ? {} : { why: want.why }),
    ...(stored.enforced === want.enforced ? {} : { enforced: want.enforced }),
    ...(stableJson(stored.params) === stableJson(want.params) ? {} : { params: want.params }),
    ...(stored.locked === want.locked ? {} : { locked: want.locked }),
    ...(stableJson(stored.applies_to) === stableJson(want.applies_to) ? {} : { applies_to: want.applies_to }),
  }
}

export function planPlaybookSync(input: {
  readonly gateway: string
  readonly version: string | null
  readonly mapped: MappedPlaybook
  readonly existing: readonly StoredRule[]
  readonly entries: number
}): PlaybookSyncPlan {
  const add: DesiredRule[] = []
  const edit: PlannedEdit[] = []
  const revoke: PlannedRevoke[] = []
  const unchanged: { n: number; source: string }[] = []
  const humanEdited: HumanEditedRecord[] = []
  const owned = input.existing
    .map((stored) => stored.rule)
    .filter((rule) => rule.status === "active" && rule.source?.startsWith(PLAYBOOK_SOURCE_PREFIX) === true)
    .sort((left, right) => left.n - right.n)
  const byIdentity = new Map<string, RuleRecord>()
  for (const rule of owned) {
    if (!byIdentity.has(identity(rule))) byIdentity.set(identity(rule), rule)
    else if (rule.set_by === PLAYBOOK_IMPORTER) revoke.push({ n: rule.n, source: rule.source ?? "", record: rule })
  }
  const matched = new Set<RuleRecord>()
  for (const desired of input.mapped.records) {
    const stored = byIdentity.get(identity(desired))
    if (stored === undefined) {
      add.push(desired)
      continue
    }
    matched.add(stored)
    const patch = patchFor(stored, desired)
    const changed = Object.keys(patch).length > 0 || !sameScope(stored, desired)
    if (stored.set_by !== PLAYBOOK_IMPORTER) {
      humanEdited.push({ n: stored.n, source: desired.source, set_by: stored.set_by, withheld: changed ? "edit" : "none" })
    } else if (!sameScope(stored, desired)) {
      revoke.push({ n: stored.n, source: desired.source, record: stored })
      add.push(desired)
    } else if (changed) {
      edit.push({ n: stored.n, source: desired.source, patch, record: { ...stored, ...patch } })
    } else {
      unchanged.push({ n: stored.n, source: desired.source })
    }
  }
  const held = new Set(input.mapped.held)
  for (const rule of byIdentity.values()) {
    if (matched.has(rule) || held.has(rule.source ?? "")) continue
    if (rule.set_by !== PLAYBOOK_IMPORTER) humanEdited.push({ n: rule.n, source: rule.source ?? "", set_by: rule.set_by, withheld: "revoke" })
    else revoke.push({ n: rule.n, source: rule.source ?? "", record: rule })
  }
  return {
    gateway: input.gateway,
    version: input.version,
    add,
    edit,
    revoke: revoke.sort((left, right) => left.n - right.n),
    unchanged,
    human_edited: humanEdited.sort((left, right) => left.n - right.n),
    held: input.mapped.held,
    problems: input.mapped.problems,
    unused_map_keys: input.mapped.unused_map_keys,
    counts: { entries: input.entries, records: input.mapped.records.length },
  }
}

export interface PlaybookDryRunOptions {
  readonly root: string
  readonly gateway: string
  readonly include?: readonly string[]
  readonly map?: PlaybookMap
  readonly store?: RulesStore
}

export async function dryRunPlaybookSync(options: PlaybookDryRunOptions): Promise<PlaybookSyncPlan> {
  const parsed = parsePlaybook(await readPlaybook(options.root, options.include))
  const mapped = mapPlaybook(parsed, { gateway: options.gateway, ...(options.map === undefined ? {} : { map: options.map }) })
  const set = options.store === undefined ? { version: null, rules: [] } : await options.store.load(options.gateway)
  return planPlaybookSync({ gateway: options.gateway, version: set.version, mapped, existing: set.rules, entries: parsed.entries.length })
}

export interface PlaybookSyncResult {
  readonly commits: number
  readonly added: readonly StoredRule[]
  readonly edited: readonly StoredRule[]
  readonly revoked: readonly StoredRule[]
}

export async function applyPlaybookSync(store: RulesStore, plan: PlaybookSyncPlan): Promise<PlaybookSyncResult> {
  const current = (await store.load(plan.gateway)).version
  if (current !== plan.version) {
    throw new PlaybookSyncError(`rules in scope ${plan.gateway} changed since the plan (planned at ${plan.version ?? "none"}, now ${current ?? "none"}); plan again`)
  }
  const revoked: StoredRule[] = []
  for (const { n } of plan.revoke) revoked.push(await store.revoke(plan.gateway, n))
  const edited: StoredRule[] = []
  for (const { n, patch } of plan.edit) edited.push(await store.edit(plan.gateway, n, patch))
  const added: StoredRule[] = []
  for (const { key: _key, ...rule } of plan.add) added.push(await store.add(rule))
  return { commits: revoked.length + edited.length + added.length, added, edited, revoked }
}
