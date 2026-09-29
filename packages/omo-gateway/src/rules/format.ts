// Rule file format: `rules/<gateway scope>/<rule id>.md` = YAML frontmatter + the rule text.
//
// Parsing is fail-closed: every malformed file (bad YAML, unknown key, unknown gate, missing
// `scope.gateway`, numeric ids that YAML would silently coerce) throws a RuleFormatError whose
// message is the reason the store reports. Serialization emits only values that parse back to
// the same record, and the store re-parses before every write.

import { describeGateParamsViolation, isGateId, type GateId, type GateParams } from "./gates"

export const RULE_KINDS = ["mechanical", "behavioral"] as const
export type RuleKind = (typeof RULE_KINDS)[number]
export const RULE_STATUSES = ["active", "revoked", "superseded"] as const
export type RuleStatus = (typeof RULE_STATUSES)[number]
export const RULE_AUDIENCES = ["lead", "worker"] as const
export type RuleAudience = (typeof RULE_AUDIENCES)[number]

export const SCOPE_KEYS = ["gateway", "surface", "chat", "thread", "user", "agent"] as const

export interface RuleScope {
  readonly gateway: string
  readonly surface: string | null
  readonly chat: string | null
  readonly thread: string | null
  readonly user: string | null
  readonly agent: string | null
}

export interface RuleRecord {
  readonly id: string
  readonly n: number
  readonly scope: RuleScope
  readonly kind: RuleKind
  readonly gate: GateId | null
  readonly params: GateParams | null
  readonly applies_to: readonly RuleAudience[]
  readonly set_by: string
  readonly source?: string
  readonly why?: string
  readonly enforced?: string
  readonly status: RuleStatus
  readonly supersedes: string | null
  readonly locked: boolean
  readonly text: string
}

export class RuleFormatError extends Error {
  override readonly name = "RuleFormatError"
}

export const RULE_ID_RE = /^r_[0-9A-HJKMNP-TV-Z]{26}$/
export const GATEWAY_SCOPE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const HEADER_KEYS = [
  "id", "n", "scope", "kind", "gate", "params", "applies_to", "set_by",
  "source", "why", "enforced", "status", "supersedes", "locked",
] as const
const HEADER_KEY_SET: ReadonlySet<string> = new Set(HEADER_KEYS)
const SCOPE_KEY_SET: ReadonlySet<string> = new Set(SCOPE_KEYS)
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/

function fail(reason: string): never {
  throw new RuleFormatError(reason)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`'${field}' must be a non-empty string`)
  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  return requireString(value, field)
}

function nullableString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string" || value.length === 0) {
    fail(`'${field}' must be a non-empty string or null (quote numeric ids)`)
  }
  return value
}

function oneOf<const T extends string>(value: unknown, options: readonly T[], field: string): T {
  const match = options.find((option) => option === value)
  if (match === undefined) fail(`'${field}' must be one of ${options.join(", ")}`)
  return match
}

function parseScope(value: unknown): RuleScope {
  if (!isPlainObject(value)) fail("'scope' must be a map with at least 'gateway'")
  for (const key of Object.keys(value)) {
    if (!SCOPE_KEY_SET.has(key)) fail(`unknown scope key '${key}' (allowed: ${SCOPE_KEYS.join(", ")})`)
  }
  if (value.gateway === undefined || value.gateway === null) fail("missing 'scope.gateway'")
  const gateway = requireString(value.gateway, "scope.gateway")
  if (!GATEWAY_SCOPE_RE.test(gateway)) fail(`'scope.gateway' is not a safe scope id: ${gateway}`)
  return {
    gateway,
    surface: nullableString(value.surface, "scope.surface"),
    chat: nullableString(value.chat, "scope.chat"),
    thread: nullableString(value.thread, "scope.thread"),
    user: nullableString(value.user, "scope.user"),
    agent: nullableString(value.agent, "scope.agent"),
  }
}

function parseGateAndParams(kind: RuleKind, gate: unknown, params: unknown): Pick<RuleRecord, "gate" | "params"> {
  if (kind === "behavioral") {
    if (gate !== undefined && gate !== null) fail("a behavioral rule must not name a gate")
    if (params !== undefined && params !== null) fail("a behavioral rule must not carry params")
    return { gate: null, params: null }
  }
  if (gate === undefined || gate === null) fail("a mechanical rule must name a gate")
  if (!isGateId(gate)) fail(`unknown gate '${String(gate)}'`)
  const resolvedParams = params === undefined || params === null ? {} : params
  const violation = describeGateParamsViolation(gate, resolvedParams)
  if (violation !== null || !isPlainObject(resolvedParams)) fail(violation ?? `params for gate '${gate}' must be a map`)
  return { gate, params: resolvedParams }
}

function parseAppliesTo(value: unknown): readonly RuleAudience[] {
  if (value === undefined) return RULE_AUDIENCES
  if (!Array.isArray(value) || value.length === 0) fail("'applies_to' must be a non-empty list of lead, worker")
  const audiences = value.map((entry) => oneOf(entry, RULE_AUDIENCES, "applies_to[]"))
  return RULE_AUDIENCES.filter((audience) => audiences.includes(audience))
}

function assertNoDuplicateKeys(header: string): void {
  const seen = new Set<string>()
  for (const line of header.split("\n")) {
    const key = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line)?.[1]
    if (key === undefined) continue
    if (seen.has(key)) fail(`duplicate frontmatter key '${key}'`)
    seen.add(key)
  }
}

function parseHeader(header: string): Record<string, unknown> {
  assertNoDuplicateKeys(header)
  let parsed: unknown
  try {
    parsed = Bun.YAML.parse(header)
  } catch (error) {
    fail(`frontmatter is not valid YAML: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isPlainObject(parsed)) fail("frontmatter must be a map")
  for (const key of Object.keys(parsed)) {
    if (!HEADER_KEY_SET.has(key)) fail(`unknown frontmatter key '${key}'`)
  }
  return parsed
}

export function parseRuleFile(content: string): RuleRecord {
  const match = FRONTMATTER_RE.exec(content.replace(/\r\n?/g, "\n"))
  if (match === null) fail("missing frontmatter (must start with --- and close with ---)")
  const header = parseHeader(match[1] ?? "")
  const id = requireString(header.id, "id")
  if (!RULE_ID_RE.test(id)) fail(`'id' must be r_ followed by a ULID: ${id}`)
  const n = header.n
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1) fail("'n' must be a positive integer")
  const kind = oneOf(header.kind, RULE_KINDS, "kind")
  const text = (match[2] ?? "").trim()
  if (text.length === 0) fail("rule text (the body after the frontmatter) must not be empty")
  const locked = header.locked ?? false
  if (typeof locked !== "boolean") fail("'locked' must be true or false")
  const source = optionalString(header.source, "source")
  const why = optionalString(header.why, "why")
  const enforced = optionalString(header.enforced, "enforced")
  return {
    id,
    n,
    scope: parseScope(header.scope),
    kind,
    ...parseGateAndParams(kind, header.gate, header.params),
    applies_to: parseAppliesTo(header.applies_to),
    set_by: requireString(header.set_by, "set_by"),
    ...(source === undefined ? {} : { source }),
    ...(why === undefined ? {} : { why }),
    ...(enforced === undefined ? {} : { enforced }),
    status: oneOf(header.status ?? "active", RULE_STATUSES, "status"),
    supersedes: nullableString(header.supersedes, "supersedes"),
    locked,
    text,
  }
}

const BARE_WORD_RE = /^[A-Za-z][A-Za-z0-9_-]*$/
const YAML_KEYWORDS: ReadonlySet<string> = new Set(["null", "true", "false", "yes", "no", "on", "off", "y", "n"])

function renderYamlString(value: string): string {
  return BARE_WORD_RE.test(value) && !YAML_KEYWORDS.has(value.toLowerCase()) ? value : JSON.stringify(value)
}

function renderYamlValue(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string") return renderYamlString(value)
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(renderYamlValue).join(", ")}]`
  if (isPlainObject(value)) {
    const entries = Object.entries(value).map(([key, entry]) => `${renderYamlString(key)}: ${renderYamlValue(entry)}`)
    return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`
  }
  fail(`cannot serialize value of type ${typeof value}`)
}

export function serializeRuleFile(rule: RuleRecord): string {
  const lines: string[] = []
  for (const key of HEADER_KEYS) {
    const value = key === "scope"
      ? Object.fromEntries(SCOPE_KEYS.map((scopeKey) => [scopeKey, rule.scope[scopeKey]]))
      : rule[key]
    if (value === undefined) continue
    lines.push(`${key}: ${renderYamlValue(value)}`)
  }
  return `---\n${lines.join("\n")}\n---\n${rule.text.trim()}\n`
}
