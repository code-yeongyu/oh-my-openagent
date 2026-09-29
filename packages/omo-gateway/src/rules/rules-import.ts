// Import a prose rules file through a mapping table into rule records (Design record
// "Conversation rules layer"). The prose file supplies each rule's text; the mapping table says, per
// rule, which bullet it is (`anchor`, a substring of exactly one line), whether it is mechanical
// (gate + params) or behavioral, and its scope. `also_behavioral` adds a behavioral record with the
// same text next to a mechanical one, for rules whose judgement a gate cannot fully carry.
//
// The whole plan is validated before the first write, so a bad map imports nothing. Entries whose
// (source, kind, gate) already exist in the scope are skipped, so a re-run adds no duplicates.
// The new rules land in one commit, so one import is one rules version.

import { describeGateParamsViolation, isGateId } from "./gates"
import { parseRuleFile, RULE_AUDIENCES, SCOPE_KEYS, serializeRuleFile, type RuleAudience, type RuleRecord } from "./format"
import type { NewRule, RulesStore, StoredRule } from "./store"

export class RulesImportError extends Error {
  override readonly name = "RulesImportError"
}

type ScopeOverride = Partial<Record<Exclude<(typeof SCOPE_KEYS)[number], "gateway">, string>>

export interface ImportMapEntry {
  readonly anchor: string
  readonly kind: "mechanical" | "behavioral"
  readonly gate?: string
  readonly params?: Readonly<Record<string, unknown>>
  readonly scope?: ScopeOverride
  readonly also_behavioral?: boolean
  readonly locked?: boolean
  readonly applies_to?: readonly RuleAudience[]
}

export interface ImportMap {
  readonly gateway: string
  readonly set_by: string
  readonly entries: readonly ImportMapEntry[]
}

export interface PlannedRule {
  readonly entry: number
  readonly line: number
  readonly rule: NewRule
}

const MAP_KEYS: ReadonlySet<string> = new Set(["gateway", "set_by", "entries"])
const ENTRY_KEYS: ReadonlySet<string> = new Set(["anchor", "kind", "gate", "params", "scope", "also_behavioral", "locked", "applies_to"])
const SCOPE_OVERRIDE_KEYS: ReadonlySet<string> = new Set(SCOPE_KEYS.filter((key) => key !== "gateway"))
const PROBE_ID = "r_00000000000000000000000000"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function fail(reason: string): never {
  throw new RulesImportError(reason)
}

function onlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, where: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${where}: unknown key '${key}'`)
}

function parseScope(value: unknown, where: string): ScopeOverride | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) fail(`${where}.scope must be a map`)
  onlyKeys(value, SCOPE_OVERRIDE_KEYS, `${where}.scope`)
  const scope: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string" || entry.length === 0) fail(`${where}.scope.${key} must be a non-empty string`)
    scope[key] = entry
  }
  return scope
}

function parseEntry(value: unknown, index: number): ImportMapEntry {
  const where = `entries[${index}]`
  if (!isRecord(value)) fail(`${where} must be a map`)
  onlyKeys(value, ENTRY_KEYS, where)
  const { anchor, kind, gate, params, also_behavioral: alsoBehavioral, locked, applies_to: appliesTo } = value
  if (typeof anchor !== "string" || anchor.trim() === "") fail(`${where}.anchor must be a non-empty string`)
  if (kind !== "mechanical" && kind !== "behavioral") fail(`${where}.kind must be mechanical or behavioral`)
  if (kind === "mechanical") {
    if (!isGateId(gate)) fail(`${where}: unknown gate '${String(gate)}'`)
    const violation = describeGateParamsViolation(gate, params ?? {})
    if (violation !== null) fail(`${where}: ${violation}`)
  } else if (gate !== undefined || params !== undefined || alsoBehavioral !== undefined) {
    fail(`${where}: a behavioral entry takes no gate, params or also_behavioral`)
  }
  if (alsoBehavioral !== undefined && typeof alsoBehavioral !== "boolean") fail(`${where}.also_behavioral must be true or false`)
  if (locked !== undefined && typeof locked !== "boolean") fail(`${where}.locked must be true or false`)
  if (appliesTo !== undefined && (!Array.isArray(appliesTo) || !appliesTo.every((entry) => RULE_AUDIENCES.some((audience) => audience === entry)))) {
    fail(`${where}.applies_to must list lead and/or worker`)
  }
  const scope = parseScope(value.scope, where)
  return {
    anchor,
    kind,
    ...(kind === "mechanical" && typeof gate === "string" ? { gate, params: isRecord(params) ? params : {} } : {}),
    ...(scope === undefined ? {} : { scope }),
    ...(alsoBehavioral === true ? { also_behavioral: true } : {}),
    ...(locked === undefined ? {} : { locked }),
    ...(Array.isArray(appliesTo) ? { applies_to: RULE_AUDIENCES.filter((audience) => appliesTo.includes(audience)) } : {}),
  }
}

export function parseImportMap(value: unknown): ImportMap {
  if (!isRecord(value)) fail("the mapping table must be a JSON object")
  onlyKeys(value, MAP_KEYS, "mapping table")
  const { gateway, set_by: setBy, entries } = value
  if (typeof gateway !== "string" || gateway === "") fail("mapping table: 'gateway' must be the scope id")
  if (typeof setBy !== "string" || setBy === "") fail("mapping table: 'set_by' must be the importing user id")
  if (!Array.isArray(entries) || entries.length === 0) fail("mapping table: 'entries' must be a non-empty list")
  return { gateway, set_by: setBy, entries: entries.map(parseEntry) }
}

function findLine(lines: readonly string[], anchor: string, index: number): number {
  const hits = lines.flatMap((line, at) => (line.includes(anchor) ? [at] : []))
  if (hits.length === 0) fail(`entries[${index}]: anchor '${anchor}' matches no line of the prose file`)
  if (hits.length > 1) fail(`entries[${index}]: anchor '${anchor}' matches ${hits.length} lines; make it unique`)
  return hits[0] ?? 0
}

function probe(rule: NewRule, index: number): void {
  const record: RuleRecord = {
    ...rule,
    id: PROBE_ID,
    n: 1,
    scope: { surface: null, chat: null, thread: null, user: null, agent: null, ...rule.scope },
    gate: rule.gate ?? null,
    params: rule.params ?? null,
    applies_to: rule.applies_to ?? RULE_AUDIENCES,
    status: "active",
    supersedes: null,
    locked: rule.locked ?? false,
  }
  try {
    parseRuleFile(serializeRuleFile(record))
  } catch (error) {
    fail(`entries[${index}]: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function planImport(prose: string, proseName: string, map: ImportMap): PlannedRule[] {
  const lines = prose.replace(/\r\n?/g, "\n").split("\n")
  const planned: PlannedRule[] = []
  map.entries.forEach((entry, index) => {
    const at = findLine(lines, entry.anchor, index)
    const text = (lines[at] ?? "").replace(/^\s*(?:[-*\u2022]|\d+[.)])\s+/, "").trim()
    const base = {
      scope: { gateway: map.gateway, ...entry.scope },
      set_by: map.set_by,
      source: `${proseName}#L${at + 1}`,
      text,
      ...(entry.locked === undefined ? {} : { locked: entry.locked }),
      ...(entry.applies_to === undefined ? {} : { applies_to: entry.applies_to }),
    }
    const rules: NewRule[] = entry.kind === "mechanical" && entry.gate !== undefined && isGateId(entry.gate)
      ? [{ ...base, kind: "mechanical", gate: entry.gate, params: entry.params ?? {} }]
      : [{ ...base, kind: "behavioral" }]
    if (entry.also_behavioral === true) rules.push({ ...base, kind: "behavioral" })
    for (const rule of rules) {
      probe(rule, index)
      planned.push({ entry: index, line: at + 1, rule })
    }
  })
  return planned
}

function identity(rule: Pick<RuleRecord, "source" | "kind" | "gate">): string {
  return `${rule.source ?? ""}\u0000${rule.kind}\u0000${rule.gate ?? ""}`
}

export interface ImportOutcome {
  readonly imported: readonly StoredRule[]
  readonly skipped: readonly { readonly source: string; readonly kind: string; readonly n: number }[]
}

export async function importRules(store: RulesStore, gateway: string, plan: readonly PlannedRule[]): Promise<ImportOutcome> {
  const existing = new Map((await store.load(gateway)).rules.map((stored) => [identity(stored.rule), stored.rule.n]))
  const fresh: NewRule[] = []
  const skipped: { source: string; kind: string; n: number }[] = []
  for (const { rule } of plan) {
    const n = existing.get(identity({ source: rule.source, kind: rule.kind, gate: rule.gate ?? null }))
    if (n === undefined) fresh.push(rule)
    else skipped.push({ source: rule.source ?? "", kind: rule.kind, n })
  }
  const sources = [...new Set(fresh.map((rule) => (rule.source ?? "").replace(/#L\d+$/, "")))].join(", ")
  return { imported: await store.addMany(gateway, fresh, `${fresh.length} rule(s) from ${sources}`), skipped }
}
