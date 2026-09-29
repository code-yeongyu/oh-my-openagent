/**
 * Scope roles and role match rules (typeclaw's tower, adapted to the gateway's origin shape).
 *
 * A role is resolved per inbound message from the scope's `role_rules`. Rules only ever grant:
 * across rules the highest matching role wins, and no match means `guest`. Every malformed
 * input - an unknown role string, a rule with a typo'd or empty field, an origin missing its
 * author - resolves to `guest` or is skipped, never to a wider grant.
 */

export const ROLES = ["guest", "member", "trusted", "owner"] as const
export type Role = (typeof ROLES)[number]

const ROLE_RANK: Readonly<Record<Role, number>> = { guest: 0, member: 1, trusted: 2, owner: 3 }

export function isRole(value: unknown): value is Role {
  return ROLES.some((role) => role === value)
}

export function roleRank(role: Role): number {
  return ROLE_RANK[role]
}

/** True when `granter` may hand out `target`: never above the granter's own role. */
export function canGrantRole(granter: Role, target: Role): boolean {
  return roleRank(target) <= roleRank(granter)
}

/**
 * `{kind:"tui"}` is the local OS user and is always `owner`. A channel rule needs `platform` and
 * `workspace` (team/guild id); `chat` also matches threads whose parent is that chat (thread
 * inherits parent), `parent_chat` matches only threads under that chat, `author` is the
 * platform user id. All present fields must match.
 */
export type MatchRule =
  | { readonly kind: "tui" }
  | {
      readonly kind: "channel"
      readonly platform: string
      readonly workspace: string
      readonly chat?: string
      readonly parent_chat?: string
      readonly author?: string
    }

/** Where an inbound message came from. `dm` is a 1:1 direct message with the gateway account. */
export type Origin =
  | { readonly kind: "tui" }
  | {
      readonly kind: "channel"
      readonly platform: string
      readonly workspace: string
      readonly chat: string
      readonly parent_chat: string | null
      readonly author: string
      readonly dm: boolean
    }

/** A `role_rules` row as the store hands it over; `role` and `match` are parsed here. */
export type RoleRuleRecord = {
  readonly id: string
  readonly gateway_scope: string
  readonly role: string
  readonly match: unknown
}

export type RoleResolution = {
  readonly role: Role
  readonly rule_id: string | null
  readonly reason: "tui_owner" | "rule_match" | "no_rule_match" | "missing_origin"
}

const CHANNEL_RULE_KEYS: ReadonlySet<string> = new Set(["kind", "platform", "workspace", "chat", "parent_chat", "author"])

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function optionalField(record: Readonly<Record<string, unknown>>, key: string): { ok: boolean; value?: string } {
  const value = record[key]
  if (value === undefined) return { ok: true }
  return isNonEmptyString(value) ? { ok: true, value } : { ok: false }
}

/** Parse a stored match rule; `null` for anything malformed (unknown keys included, since a typo'd key would widen the rule). */
export function parseMatchRule(value: unknown): MatchRule | null {
  if (!isRecord(value)) return null
  if (value.kind === "tui") return Object.keys(value).length === 1 ? { kind: "tui" } : null
  if (value.kind !== "channel") return null
  if (Object.keys(value).some((key) => !CHANNEL_RULE_KEYS.has(key))) return null
  if (!isNonEmptyString(value.platform) || !isNonEmptyString(value.workspace)) return null
  const chat = optionalField(value, "chat")
  const parentChat = optionalField(value, "parent_chat")
  const author = optionalField(value, "author")
  if (!chat.ok || !parentChat.ok || !author.ok) return null
  return {
    kind: "channel",
    platform: value.platform,
    workspace: value.workspace,
    ...(chat.value === undefined ? {} : { chat: chat.value }),
    ...(parentChat.value === undefined ? {} : { parent_chat: parentChat.value }),
    ...(author.value === undefined ? {} : { author: author.value }),
  }
}

/** Parse an origin handed in by a connector or CLI path; `null` when any required field is missing. */
export function parseOrigin(value: unknown): Origin | null {
  if (!isRecord(value)) return null
  if (value.kind === "tui") return { kind: "tui" }
  if (value.kind !== "channel") return null
  const { platform, workspace, chat, author, dm } = value
  const parentChat = value.parent_chat
  if (!isNonEmptyString(platform) || !isNonEmptyString(workspace) || !isNonEmptyString(chat)) return null
  if (!isNonEmptyString(author) || typeof dm !== "boolean") return null
  if (parentChat !== null && !isNonEmptyString(parentChat)) return null
  return { kind: "channel", platform, workspace, chat, parent_chat: parentChat, author, dm }
}

export function matchesOrigin(rule: MatchRule, origin: Origin): boolean {
  if (rule.kind === "tui" || origin.kind === "tui") return rule.kind === origin.kind
  if (rule.platform !== origin.platform || rule.workspace !== origin.workspace) return false
  if (rule.chat !== undefined && rule.chat !== origin.chat && rule.chat !== origin.parent_chat) return false
  if (rule.parent_chat !== undefined && rule.parent_chat !== origin.parent_chat) return false
  if (rule.author !== undefined && rule.author !== origin.author) return false
  return true
}

/**
 * Resolve the scope role for one inbound message. The TUI is always `owner`; a channel origin gets
 * the highest role among the scope's valid matching rules, else `guest`. Rules of other scopes,
 * rules with an unknown role and malformed rules never match.
 */
export function resolveRole(rules: readonly RoleRuleRecord[], gatewayScope: string, originInput: unknown): RoleResolution {
  const origin = parseOrigin(originInput)
  if (origin === null) return { role: "guest", rule_id: null, reason: "missing_origin" }
  if (origin.kind === "tui") return { role: "owner", rule_id: null, reason: "tui_owner" }
  let best: { role: Role; rule_id: string } | null = null
  for (const record of rules) {
    if (record.gateway_scope !== gatewayScope || !isRole(record.role)) continue
    const rule = parseMatchRule(record.match)
    if (rule === null || rule.kind === "tui" || !matchesOrigin(rule, origin)) continue
    if (best === null || roleRank(record.role) > roleRank(best.role)) best = { role: record.role, rule_id: record.id }
  }
  if (best === null) return { role: "guest", rule_id: null, reason: "no_rule_match" }
  return { role: best.role, rule_id: best.rule_id, reason: "rule_match" }
}
