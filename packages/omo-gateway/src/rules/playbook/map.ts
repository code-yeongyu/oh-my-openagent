// Playbook entries -> rule records (record shape: ../format.ts).
//
// Every entry becomes one record whose `source` is `playbook:<entry key>`, the idempotency key the
// sync diff matches on. The rule file decides the surface (slack.md -> slack, ... every other file
// -> scope-wide). An entry is `mechanical` only when the scope's data mapping table
// (`rules/<scope>/_playbook-map.json` in the scope memory repo) names a gate from the closed set for
// its key; every other entry, and every lesson, is `behavioral`. The table is data, so mapping a
// new playbook rule to a gate never needs a code change.

import { describeGateParamsViolation, isGateId, type GateId, type GateParams } from "../gates"
import { parseRuleFile, RULE_AUDIENCES, serializeRuleFile, type RuleAudience, type RuleRecord } from "../format"
import type { NewRule } from "../store"
import type { ParsedPlaybook, PlaybookEntry, PlaybookLessonEntry, PlaybookProblem, PlaybookRuleEntry } from "./parse"

export const PLAYBOOK_IMPORTER = "importer:playbook"
export const PLAYBOOK_SOURCE_PREFIX = "playbook:"
export const PLAYBOOK_MAP_FILE = "_playbook-map.json"
export const PLAYBOOK_SURFACES = ["slack", "discord", "telegram", "notion", "github"] as const
export type PlaybookSurface = (typeof PLAYBOOK_SURFACES)[number]

export interface PlaybookMapEntry {
  readonly gate: GateId
  readonly params: GateParams
  readonly also_behavioral: boolean
  readonly locked: boolean
  readonly applies_to: readonly RuleAudience[]
}

export interface PlaybookMap {
  /** Surface value written into `scope.surface` per playbook surface file; default is the bare name. */
  readonly surfaces: Readonly<Partial<Record<PlaybookSurface, string>>>
  readonly entries: Readonly<Record<string, PlaybookMapEntry>>
}

export type DesiredRule = NewRule & { readonly source: string; readonly key: string }

export interface MappedPlaybook {
  readonly records: readonly DesiredRule[]
  readonly problems: readonly PlaybookProblem[]
  /** Sources that exist in the playbook but could not be mapped; the sync never revokes their records. */
  readonly held: readonly string[]
  /** Map keys that match no rule entry of the playbook (stale or mistyped). */
  readonly unused_map_keys: readonly string[]
}

export class PlaybookMapError extends Error {
  override readonly name = "PlaybookMapError"
}

export const EMPTY_PLAYBOOK_MAP: PlaybookMap = { surfaces: {}, entries: {} }

const MAP_KEYS: ReadonlySet<string> = new Set(["surfaces", "entries"])
const ENTRY_KEYS: ReadonlySet<string> = new Set(["gate", "params", "also_behavioral", "locked", "applies_to"])
const PROBE_ID = "r_00000000000000000000000000"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function fail(reason: string): never {
  throw new PlaybookMapError(reason)
}

function isPlaybookSurface(value: string): value is PlaybookSurface {
  return PLAYBOOK_SURFACES.some((surface) => surface === value)
}

function onlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, where: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${where}: unknown key '${key}'`)
}

function parseBoolean(value: unknown, where: string): boolean {
  if (value === undefined) return false
  if (typeof value !== "boolean") fail(`${where} must be true or false`)
  return value
}

function parseAudiences(value: unknown, where: string): readonly RuleAudience[] {
  if (value === undefined) return RULE_AUDIENCES
  if (!Array.isArray(value) || value.length === 0) fail(`${where} must be a non-empty list of lead, worker`)
  const listed = value.filter((entry): entry is RuleAudience => RULE_AUDIENCES.some((audience) => audience === entry))
  if (listed.length !== value.length) fail(`${where} must list only lead and/or worker`)
  return RULE_AUDIENCES.filter((audience) => listed.includes(audience))
}

function parseMapEntry(key: string, value: unknown): PlaybookMapEntry {
  const where = `entries['${key}']`
  if (!key.includes("#")) fail(`${where}: keys are rule entry keys (<file>.md#<heading-slug>)`)
  if (!isRecord(value)) fail(`${where} must be a map`)
  onlyKeys(value, ENTRY_KEYS, where)
  if (!isGateId(value.gate)) fail(`${where}: unknown gate '${String(value.gate)}' (the gate set is closed)`)
  const params = value.params ?? {}
  const violation = describeGateParamsViolation(value.gate, params)
  if (violation !== null || !isRecord(params)) fail(`${where}: ${violation ?? "params must be a map"}`)
  return {
    gate: value.gate,
    params,
    also_behavioral: parseBoolean(value.also_behavioral, `${where}.also_behavioral`),
    locked: parseBoolean(value.locked, `${where}.locked`),
    applies_to: parseAudiences(value.applies_to, `${where}.applies_to`),
  }
}

export function parsePlaybookMap(value: unknown): PlaybookMap {
  if (!isRecord(value)) fail("the playbook map must be a JSON object")
  onlyKeys(value, MAP_KEYS, "playbook map")
  const surfaces: Partial<Record<PlaybookSurface, string>> = {}
  const rawSurfaces = value.surfaces ?? {}
  if (!isRecord(rawSurfaces)) fail("playbook map: 'surfaces' must be a map")
  for (const [name, surface] of Object.entries(rawSurfaces)) {
    if (!isPlaybookSurface(name)) fail(`playbook map: unknown surface '${name}' (known: ${PLAYBOOK_SURFACES.join(", ")})`)
    if (typeof surface !== "string" || surface === "") fail(`playbook map: surfaces.${name} must be a non-empty string`)
    surfaces[name] = surface
  }
  const rawEntries = value.entries ?? {}
  if (!isRecord(rawEntries)) fail("playbook map: 'entries' must be a map keyed by entry key")
  const entries: Record<string, PlaybookMapEntry> = {}
  for (const [key, entry] of Object.entries(rawEntries)) entries[key] = parseMapEntry(key, entry)
  return { surfaces, entries }
}

function surfaceOf(file: string, map: PlaybookMap): string | null {
  const name = (file.split("/").at(-1) ?? file).replace(/\.md$/, "")
  if (!isPlaybookSurface(name)) return null
  return map.surfaces[name] ?? name
}

function ruleWhy(entry: PlaybookRuleEntry): string | undefined {
  if (entry.lesson === undefined) return entry.why
  return entry.why === undefined ? `Lesson: ${entry.lesson}` : `${entry.why} Lesson: ${entry.lesson}`
}

function lessonWhy(entry: PlaybookLessonEntry): string | undefined {
  if (entry.impact === undefined) return entry.what_happened
  return entry.what_happened === undefined ? `Impact: ${entry.impact}` : `${entry.what_happened} Impact: ${entry.impact}`
}

function lessonText(entry: PlaybookLessonEntry): string {
  return entry.fix === undefined ? `lesson: ${entry.title}` : `lesson: ${entry.title} - ${entry.fix}`
}

function annotations(why: string | undefined, enforced: string | undefined): { why?: string; enforced?: string } {
  return { ...(why === undefined ? {} : { why }), ...(enforced === undefined ? {} : { enforced }) }
}

function recordsFor(entry: PlaybookEntry, gateway: string, map: PlaybookMap): DesiredRule[] {
  const source = `${PLAYBOOK_SOURCE_PREFIX}${entry.key}`
  if (entry.kind === "lesson") {
    return [{ key: entry.key, source, scope: { gateway }, kind: "behavioral", set_by: PLAYBOOK_IMPORTER, text: lessonText(entry), ...annotations(lessonWhy(entry), undefined) }]
  }
  const surface = surfaceOf(entry.file, map)
  const base = {
    key: entry.key,
    source,
    scope: surface === null ? { gateway } : { gateway, surface },
    set_by: PLAYBOOK_IMPORTER,
    text: entry.heading,
    ...annotations(ruleWhy(entry), entry.enforced),
  }
  const mapped = map.entries[entry.key]
  if (mapped === undefined) return [{ ...base, kind: "behavioral" }]
  const shared = { ...base, locked: mapped.locked, applies_to: mapped.applies_to }
  const mechanical: DesiredRule = { ...shared, kind: "mechanical", gate: mapped.gate, params: mapped.params }
  return mapped.also_behavioral ? [mechanical, { ...shared, kind: "behavioral" }] : [mechanical]
}

function probe(rule: DesiredRule): string | null {
  const { key: _key, ...fields } = rule
  const record: RuleRecord = {
    ...fields,
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
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export function mapPlaybook(parsed: ParsedPlaybook, options: { readonly gateway: string; readonly map?: PlaybookMap }): MappedPlaybook {
  const map = options.map ?? EMPTY_PLAYBOOK_MAP
  const records: DesiredRule[] = []
  const problems: PlaybookProblem[] = [...parsed.problems]
  const held: string[] = []
  for (const entry of parsed.entries) {
    const candidates = recordsFor(entry, options.gateway, map)
    const reason = candidates.map(probe).find((result) => result !== null)
    if (reason !== undefined) {
      problems.push({ file: entry.file, line: entry.line, severity: "error", reason: `entry does not form a valid rule record: ${reason}` })
      held.push(`${PLAYBOOK_SOURCE_PREFIX}${entry.key}`)
      continue
    }
    records.push(...candidates)
  }
  const ruleKeys = new Set(parsed.entries.filter((entry) => entry.kind === "rule").map((entry) => entry.key))
  const unused = Object.keys(map.entries).filter((key) => !ruleKeys.has(key))
  return { records, problems, held, unused_map_keys: unused }
}
