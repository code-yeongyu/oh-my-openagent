import { type Actor, decide, type DecisionReason } from "./decide"

/**
 * The O7 session model. Every session has exactly one owner, fixed at creation: the requester for
 * a session opened on a human's request, otherwise the spawning session's owner. `parent` is the
 * spawned-by pointer for provenance and status roll-up only - permissions never read it.
 * Collaborators are humans the owner (or a scope owner) invited. After creation no agent can
 * change the owner; the one creation-time exception is adopting a validated requester on a still
 * unbound session whose owner was only inherited (the `gateway_thread_open {requester}` path).
 *
 * All functions are pure: they return the next `SessionMeta` or a refusal, and persist nothing.
 */

/** How the current owner was set: at a human's request, inherited at spawn, or by a transfer. */
export type OwnerOrigin = "requester" | "inherited" | "transfer"

export type SessionMeta = {
  readonly session_durable_id: string
  readonly owner_user_id: string
  readonly owner_origin: OwnerOrigin
  readonly parent_session_durable_id: string | null
  readonly collaborator_user_ids: readonly string[]
  readonly created_at: string
}

export type SessionRefusal =
  | DecisionReason
  | "requester_not_in_conversation"
  | "session_already_bound"
  | "owner_not_inherited"
  | "missing_user"
  | "already_owner"
  | "already_collaborator"
  | "not_collaborator"

export type SessionChange = { readonly ok: true; readonly session: SessionMeta } | { readonly ok: false; readonly reason: SessionRefusal }

type NewSession = { readonly session_durable_id: string; readonly created_at: string }

const refuse = (reason: SessionRefusal): SessionChange => ({ ok: false, reason })

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

/** A session opened on a human's request (a connector work item): the requester owns it. */
export function createRequestedSession(
  input: NewSession & { readonly requester_user_id: string; readonly parent_session_durable_id: string | null },
): SessionMeta {
  return {
    session_durable_id: input.session_durable_id,
    owner_user_id: input.requester_user_id,
    owner_origin: "requester",
    parent_session_durable_id: input.parent_session_durable_id,
    collaborator_user_ids: [],
    created_at: input.created_at,
  }
}

/** A session spawned by another session: same owner, parent = the spawner, no collaborators carried over. */
export function spawnSession(parent: SessionMeta, input: NewSession): SessionMeta {
  return {
    session_durable_id: input.session_durable_id,
    owner_user_id: parent.owner_user_id,
    owner_origin: "inherited",
    parent_session_durable_id: parent.session_durable_id,
    collaborator_user_ids: [],
    created_at: input.created_at,
  }
}

/** A handoff is a sibling session with the same owner; the handing-off session is its parent. */
export function handoffSession(from: SessionMeta, input: NewSession): SessionMeta {
  return spawnSession(from, input)
}

/**
 * Creation-time owner adoption (`gateway_thread_open {requester}`): allowed once, only while the
 * session has no binding, only when the owner was inherited, and only for a requester who is the
 * actor of a delivery the calling session received.
 */
export function adoptRequester(
  session: SessionMeta,
  input: { readonly requester_user_id: string; readonly requester_in_conversation: boolean; readonly bound: boolean },
): SessionChange {
  if (!isNonEmptyString(input.requester_user_id)) return refuse("missing_user")
  if (input.requester_in_conversation !== true) return refuse("requester_not_in_conversation")
  if (input.bound !== false) return refuse("session_already_bound")
  if (session.owner_origin !== "inherited") return refuse("owner_not_inherited")
  return { ok: true, session: { ...session, owner_user_id: input.requester_user_id, owner_origin: "requester" } }
}

/**
 * Transfer ownership: only a scope owner transfers (decided 2026-09-29: a session owner may close
 * but not transfer; only a scope owner transfers). Agents are always refused.
 */
export function transferOwner(session: SessionMeta, actor: Actor | null | undefined, newOwnerUserId: string): SessionChange {
  const decision = decide(actor, "close_transfer_session", session, { session_op: "transfer" })
  if (!decision.allow) return refuse(decision.reason)
  if (!isNonEmptyString(newOwnerUserId)) return refuse("missing_user")
  if (newOwnerUserId === session.owner_user_id) return refuse("already_owner")
  return {
    ok: true,
    session: {
      ...session,
      owner_user_id: newOwnerUserId,
      owner_origin: "transfer",
      collaborator_user_ids: session.collaborator_user_ids.filter((userId) => userId !== newOwnerUserId),
    },
  }
}

export function inviteCollaborator(session: SessionMeta, actor: Actor | null | undefined, userId: string): SessionChange {
  const decision = decide(actor, "invite_collaborator", session)
  if (!decision.allow) return refuse(decision.reason)
  if (!isNonEmptyString(userId)) return refuse("missing_user")
  if (userId === session.owner_user_id) return refuse("already_owner")
  if (session.collaborator_user_ids.includes(userId)) return refuse("already_collaborator")
  return { ok: true, session: { ...session, collaborator_user_ids: [...session.collaborator_user_ids, userId] } }
}

export function uninviteCollaborator(session: SessionMeta, actor: Actor | null | undefined, userId: string): SessionChange {
  const decision = decide(actor, "invite_collaborator", session)
  if (!decision.allow) return refuse(decision.reason)
  if (!session.collaborator_user_ids.includes(userId)) return refuse("not_collaborator")
  return { ok: true, session: { ...session, collaborator_user_ids: session.collaborator_user_ids.filter((id) => id !== userId) } }
}
