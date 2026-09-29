import { describe, expect, test } from "bun:test"

import type { Actor } from "./decide"
import {
  adoptRequester,
  createRequestedSession,
  handoffSession,
  inviteCollaborator,
  spawnSession,
  transferOwner,
  uninviteCollaborator,
} from "./session"

const ALICE = "u_000ALICE"
const BOB = "u_000BOB"
const AT = "2026-09-29T00:00:00.000Z"
const human = (userId: string, role: "guest" | "member" | "trusted" | "owner"): Actor => ({ principal: "human", user_id: userId, role })
const AGENT: Actor = { principal: "agent", session_durable_id: "s_000LEAD" }
const lead = () => createRequestedSession({ session_durable_id: "s_000LEAD", requester_user_id: ALICE, parent_session_durable_id: null, created_at: AT })

describe("O7 session ownership", () => {
  test("a session opened on a human's request is owned by the requester", () => {
    expect(lead()).toEqual({
      session_durable_id: "s_000LEAD",
      owner_user_id: ALICE,
      owner_origin: "requester",
      parent_session_durable_id: null,
      collaborator_user_ids: [],
      created_at: AT,
    })
  })

  test("a spawned session inherits the parent's owner and points at the parent", () => {
    const parent = inviteCollaborator(lead(), human(ALICE, "member"), BOB)
    if (!parent.ok) throw new Error(parent.reason)
    const child = spawnSession(parent.session, { session_durable_id: "s_000CHILD", created_at: AT })
    expect(child.owner_user_id).toBe(ALICE)
    expect(child.owner_origin).toBe("inherited")
    expect(child.parent_session_durable_id).toBe("s_000LEAD")
    expect(child.collaborator_user_ids).toEqual([])
  })

  test("a handoff is a sibling with the same owner and the handing-off session as parent", () => {
    const worker = spawnSession(lead(), { session_durable_id: "s_000WORKER", created_at: AT })
    const sibling = handoffSession(worker, { session_durable_id: "s_000SIBLING", created_at: AT })
    expect(sibling.owner_user_id).toBe(worker.owner_user_id)
    expect(sibling.parent_session_durable_id).toBe("s_000WORKER")
  })

  test("adopting a validated requester before the first binding is part of creation", () => {
    const child = spawnSession(lead(), { session_durable_id: "s_000CHILD", created_at: AT })
    const adopted = adoptRequester(child, { requester_user_id: BOB, requester_in_conversation: true, bound: false })
    expect(adopted).toEqual({ ok: true, session: { ...child, owner_user_id: BOB, owner_origin: "requester" } })
  })

  test("an agent cannot change the owner after creation", () => {
    const child = spawnSession(lead(), { session_durable_id: "s_000CHILD", created_at: AT })
    expect(adoptRequester(child, { requester_user_id: BOB, requester_in_conversation: true, bound: true })).toEqual({ ok: false, reason: "session_already_bound" })
    expect(adoptRequester(child, { requester_user_id: BOB, requester_in_conversation: false, bound: false })).toEqual({ ok: false, reason: "requester_not_in_conversation" })
    const once = adoptRequester(child, { requester_user_id: BOB, requester_in_conversation: true, bound: false })
    if (!once.ok) throw new Error(once.reason)
    expect(adoptRequester(once.session, { requester_user_id: "u_000MALLORY", requester_in_conversation: true, bound: false })).toEqual({
      ok: false,
      reason: "owner_not_inherited",
    })
    expect(transferOwner(child, AGENT, BOB)).toEqual({ ok: false, reason: "agent_principal" })
    expect(inviteCollaborator(child, AGENT, BOB)).toEqual({ ok: false, reason: "agent_principal" })
  })

  test("transfer follows the close/transfer row: only a scope owner transfers (option A)", () => {
    const session = lead()
    expect(transferOwner(session, human(BOB, "trusted"), BOB)).toEqual({ ok: false, reason: "not_session_owner" })
    expect(transferOwner(session, human(BOB, "guest"), BOB)).toEqual({ ok: false, reason: "role_denied" })
    expect(transferOwner(session, human(ALICE, "member"), BOB)).toEqual({ ok: false, reason: "transfer_needs_scope_owner" })
    expect(transferOwner(session, human(ALICE, "trusted"), BOB)).toEqual({ ok: false, reason: "transfer_needs_scope_owner" })
    const byScopeOwner = transferOwner(session, human("u_000SCOPEOWNER", "owner"), BOB)
    expect(byScopeOwner.ok && byScopeOwner.session.owner_user_id).toBe(BOB)
    expect(byScopeOwner.ok && byScopeOwner.session.owner_origin).toBe("transfer")
    expect(transferOwner(session, human("u_000SCOPEOWNER", "owner"), ALICE)).toEqual({ ok: false, reason: "already_owner" })
  })
})

describe("collaborators", () => {
  test("only the session owner or a scope owner invites and uninvites", () => {
    const session = lead()
    expect(inviteCollaborator(session, human(BOB, "trusted"), BOB)).toEqual({ ok: false, reason: "not_session_owner" })
    const invited = inviteCollaborator(session, human(ALICE, "member"), BOB)
    if (!invited.ok) throw new Error(invited.reason)
    expect(invited.session.collaborator_user_ids).toEqual([BOB])
    expect(inviteCollaborator(invited.session, human(ALICE, "member"), BOB)).toEqual({ ok: false, reason: "already_collaborator" })
    expect(inviteCollaborator(invited.session, human(ALICE, "member"), ALICE)).toEqual({ ok: false, reason: "already_owner" })
    expect(uninviteCollaborator(invited.session, human(BOB, "trusted"), BOB)).toEqual({ ok: false, reason: "not_session_owner" })
    const removed = uninviteCollaborator(invited.session, human("u_000SCOPEOWNER", "owner"), BOB)
    expect(removed.ok && removed.session.collaborator_user_ids).toEqual([])
  })
})
