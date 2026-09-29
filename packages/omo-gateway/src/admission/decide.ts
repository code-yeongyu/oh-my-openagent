import { canGrantRole, isRole, type Role } from "./roles"

/**
 * The permission decision table (plan "Permission model") as data, and `decide()` over it.
 * `decide` reads only the actor's scope role, the session's owner and its collaborators - never
 * the parent pointer - and denies anything it cannot classify: a missing or malformed actor, an
 * unknown action, a session action without a session, or missing action detail.
 */

export const ACTIONS = [
  "talk",
  "open_work_item",
  "steer_session",
  "answer_question",
  "approve_risky_tool",
  "bind_thread",
  "invite_collaborator",
  "close_transfer_session",
  "set_rule",
  "grant_role",
] as const
export type Action = (typeof ACTIONS)[number]

export const RISKS = ["low", "medium", "high"] as const
export type Risk = (typeof RISKS)[number]

/** What a `close_transfer_session` request does; required, so a request that does not say denies. */
export const SESSION_OPS = ["close", "transfer"] as const
export type SessionOp = (typeof SESSION_OPS)[number]

/** Where a grant is issued: the TUI, a 1:1 DM with the gateway account, or a group chat. */
export type Via = "tui" | "dm" | "group"

/** Agents (session principals) never hold human authority; every table action denies them. */
export type Actor =
  | { readonly principal: "human"; readonly user_id: string; readonly role: Role }
  | { readonly principal: "agent"; readonly session_durable_id: string }

export type SessionAuthority = {
  readonly owner_user_id: string
  readonly collaborator_user_ids: readonly string[]
}

/** `thread.owner_user_id` is the owner of the session bound to that chat thread (null when unbound). */
export type RuleTarget =
  | { readonly kind: "user"; readonly user_id: string }
  | { readonly kind: "thread"; readonly owner_user_id: string | null }
  | { readonly kind: "channel" }
  | { readonly kind: "scope" }

export type Grant = { readonly kind: "role"; readonly role: Role } | { readonly kind: "link_code"; readonly for_user_id: string }

export type ActionDetail = {
  readonly asked_user_id?: string
  readonly risk?: Risk
  readonly rule_target?: RuleTarget
  readonly via?: Via
  readonly grant?: Grant
  readonly session_op?: SessionOp
}

type RuleCell = {
  readonly kind: "rule_targets"
  readonly self: boolean
  readonly other_user: boolean
  readonly thread: "none" | "own" | "any"
  readonly channel: boolean
  readonly scope: boolean
}

export type Cell =
  | { readonly kind: "deny" }
  | { readonly kind: "allow" }
  | { readonly kind: "session_owner" }
  | { readonly kind: "session_owner_or_collaborator" }
  | { readonly kind: "asked_user_or_session_owner" }
  | { readonly kind: "risk"; readonly who: "session_owner" | "anyone"; readonly max: Risk }
  | { readonly kind: "session_op"; readonly who: "session_owner" | "anyone"; readonly transfer: boolean }
  | RuleCell
  | { readonly kind: "grant"; readonly via: readonly Via[] }

const NO = { kind: "deny" } as const
const YES = { kind: "allow" } as const
const SESSION_OWNER = { kind: "session_owner" } as const

/**
 * The session-owner transfer rule, decided 2026-09-29: a session owner may close but not transfer;
 * only a scope owner transfers. A member/trusted session owner may always CLOSE their own session;
 * `false` keeps TRANSFER for the scope owner alone. It is read only here, through the
 * `close_transfer_session` cells below, so `transferOwner` in session.ts (which asks `decide` with
 * `session_op: "transfer"`) follows it with no second check. Agents are always refused either way.
 * Flipping it also needs the cell tests in decide.test.ts, decide-table.test.ts and session.test.ts
 * updated.
 */
export const SESSION_OWNER_MAY_TRANSFER: boolean = false

export const DECISION_TABLE = {
  talk: { guest: NO, member: YES, trusted: YES, owner: YES },
  open_work_item: { guest: NO, member: YES, trusted: YES, owner: YES },
  steer_session: { guest: NO, member: SESSION_OWNER, trusted: { kind: "session_owner_or_collaborator" }, owner: YES },
  answer_question: {
    guest: NO,
    member: { kind: "asked_user_or_session_owner" },
    trusted: { kind: "asked_user_or_session_owner" },
    owner: YES,
  },
  approve_risky_tool: {
    guest: NO,
    member: NO,
    trusted: { kind: "risk", who: "session_owner", max: "medium" },
    owner: { kind: "risk", who: "anyone", max: "high" },
  },
  bind_thread: { guest: NO, member: NO, trusted: YES, owner: YES },
  invite_collaborator: { guest: NO, member: SESSION_OWNER, trusted: SESSION_OWNER, owner: YES },
  close_transfer_session: {
    guest: NO,
    member: { kind: "session_op", who: "session_owner", transfer: SESSION_OWNER_MAY_TRANSFER },
    trusted: { kind: "session_op", who: "session_owner", transfer: SESSION_OWNER_MAY_TRANSFER },
    owner: { kind: "session_op", who: "anyone", transfer: true },
  },
  set_rule: {
    guest: NO,
    member: { kind: "rule_targets", self: true, other_user: false, thread: "own", channel: false, scope: false },
    trusted: { kind: "rule_targets", self: true, other_user: false, thread: "any", channel: true, scope: false },
    owner: { kind: "rule_targets", self: true, other_user: true, thread: "any", channel: true, scope: true },
  },
  grant_role: { guest: NO, member: NO, trusted: NO, owner: { kind: "grant", via: ["tui", "dm"] } },
} as const satisfies Readonly<Record<Action, Readonly<Record<Role, Cell>>>>

/** Actions that act on one session: without a session they deny for every role. */
const SESSION_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "steer_session",
  "answer_question",
  "approve_risky_tool",
  "invite_collaborator",
  "close_transfer_session",
])

export type DecisionReason =
  | "allowed"
  | "missing_actor"
  | "agent_principal"
  | "unknown_action"
  | "role_denied"
  | "missing_session"
  | "not_session_owner"
  | "not_owner_or_collaborator"
  | "not_asked_or_session_owner"
  | "missing_risk"
  | "missing_session_op"
  | "transfer_needs_scope_owner"
  | "risk_above_role"
  | "missing_rule_target"
  | "rule_scope_denied"
  | "missing_grant"
  | "grant_outside_tui_or_dm"
  | "grant_above_role"

export type Decision = { readonly allow: boolean; readonly reason: DecisionReason }

const ALLOWED: Decision = { allow: true, reason: "allowed" }
const deny = (reason: DecisionReason): Decision => ({ allow: false, reason })

export function isAction(value: unknown): value is Action {
  return ACTIONS.some((action) => action === value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

/** A human actor with a non-empty user id and a role in `ROLES`; anything else is `missing_actor`. */
export function validHuman(actor: Actor | null | undefined): actor is Extract<Actor, { principal: "human" }> {
  return actor?.principal === "human" && isNonEmptyString(actor.user_id) && isRole(actor.role)
}

function validSession(session: SessionAuthority | null | undefined): session is SessionAuthority {
  return (
    session !== null &&
    session !== undefined &&
    isNonEmptyString(session.owner_user_id) &&
    Array.isArray(session.collaborator_user_ids) &&
    session.collaborator_user_ids.every(isNonEmptyString)
  )
}

function isSessionOp(value: unknown): value is SessionOp {
  return SESSION_OPS.some((op) => op === value)
}

function riskRank(risk: unknown): number {
  return RISKS.findIndex((known) => known === risk)
}

function decideRuleTarget(cell: RuleCell, userId: string, target: RuleTarget | undefined): Decision {
  switch (target?.kind) {
    case undefined:
      return deny("missing_rule_target")
    case "user":
      if (!isNonEmptyString(target.user_id)) return deny("missing_rule_target")
      return (target.user_id === userId ? cell.self : cell.other_user) ? ALLOWED : deny("rule_scope_denied")
    case "thread":
      if (cell.thread === "any") return ALLOWED
      return cell.thread === "own" && target.owner_user_id === userId ? ALLOWED : deny("rule_scope_denied")
    case "channel":
      return cell.channel ? ALLOWED : deny("rule_scope_denied")
    case "scope":
      return cell.scope ? ALLOWED : deny("rule_scope_denied")
    default:
      return deny("missing_rule_target")
  }
}

function decideGrant(granter: Role, via: readonly Via[], detail: ActionDetail): Decision {
  const grant = detail.grant
  if (detail.via === undefined || !via.includes(detail.via)) return deny("grant_outside_tui_or_dm")
  if (grant?.kind === "role") return isRole(grant.role) && canGrantRole(granter, grant.role) ? ALLOWED : deny("grant_above_role")
  if (grant?.kind === "link_code") return isNonEmptyString(grant.for_user_id) ? ALLOWED : deny("missing_grant")
  return deny("missing_grant")
}

function decideCell(cell: Cell, actor: { user_id: string; role: Role }, session: SessionAuthority | null, detail: ActionDetail): Decision {
  const isOwner = session !== null && session.owner_user_id === actor.user_id
  switch (cell.kind) {
    case "deny":
      return deny("role_denied")
    case "allow":
      return ALLOWED
    case "session_owner":
      return isOwner ? ALLOWED : deny("not_session_owner")
    case "session_owner_or_collaborator":
      return isOwner || session?.collaborator_user_ids.includes(actor.user_id) === true ? ALLOWED : deny("not_owner_or_collaborator")
    case "asked_user_or_session_owner":
      return isOwner || (isNonEmptyString(detail.asked_user_id) && detail.asked_user_id === actor.user_id)
        ? ALLOWED
        : deny("not_asked_or_session_owner")
    case "risk": {
      const rank = riskRank(detail.risk)
      if (rank < 0) return deny("missing_risk")
      if (cell.who === "session_owner" && !isOwner) return deny("not_session_owner")
      return rank <= riskRank(cell.max) ? ALLOWED : deny("risk_above_role")
    }
    case "session_op":
      if (!isSessionOp(detail.session_op)) return deny("missing_session_op")
      if (cell.who === "session_owner" && !isOwner) return deny("not_session_owner")
      return detail.session_op === "transfer" && !cell.transfer ? deny("transfer_needs_scope_owner") : ALLOWED
    case "rule_targets":
      return decideRuleTarget(cell, actor.user_id, detail.rule_target)
    case "grant":
      return decideGrant(actor.role, cell.via, detail)
  }
}

/** Decide one action for one actor, from the table alone. Unknown or incomplete input denies. */
export function decide(
  actor: Actor | null | undefined,
  action: string,
  session: SessionAuthority | null | undefined,
  detail: ActionDetail = {},
): Decision {
  if (actor?.principal === "agent") return deny("agent_principal")
  if (!validHuman(actor)) return deny("missing_actor")
  if (!isAction(action)) return deny("unknown_action")
  const known = validSession(session) ? session : null
  if (SESSION_ACTIONS.has(action) && known === null) return deny("missing_session")
  const cell: Cell = DECISION_TABLE[action][actor.role]
  return decideCell(cell, actor, known, detail)
}
