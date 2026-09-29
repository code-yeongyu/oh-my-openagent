import { describe, expect, test } from "bun:test"

import { ACTIONS, type Actor, decide, type SessionAuthority } from "./decide"
import { createRequestedSession, spawnSession, transferOwner } from "./session"

const ALICE = "u_000ALICE"
const BOB = "u_000BOB"
const owner = (userId: string): Actor => ({ principal: "human", user_id: userId, role: "owner" })
const member = (userId: string): Actor => ({ principal: "human", user_id: userId, role: "member" })
const trusted = (userId: string): Actor => ({ principal: "human", user_id: userId, role: "trusted" })
const ALICE_SESSION: SessionAuthority = { owner_user_id: ALICE, collaborator_user_ids: [] }

describe("decide fails closed on malformed input", () => {
  test("unknown action strings deny even for the scope owner", () => {
    for (const action of ["", "steer", "STEER_SESSION", "grant_roles", "__proto__", "toString"]) {
      expect(decide(owner(ALICE), action, ALICE_SESSION)).toEqual({ allow: false, reason: "unknown_action" })
    }
  })

  test("missing or malformed actors deny every action", () => {
    const malformed: unknown[] = [
      null,
      undefined,
      {},
      { principal: "human", user_id: ALICE },
      { principal: "human", user_id: "", role: "owner" },
      { principal: "human", user_id: ALICE, role: "admin" },
      { principal: "human", user_id: ALICE, role: "Owner" },
      { principal: "robot", user_id: ALICE, role: "owner" },
    ]
    for (const actor of malformed) {
      for (const action of ACTIONS) {
        expect(decide(JSON.parse(JSON.stringify(actor ?? null)), action, ALICE_SESSION).allow).toBe(false)
      }
    }
  })

  test("agent principals hold no human authority on any action", () => {
    const agent: Actor = { principal: "agent", session_durable_id: "s_000LEAD" }
    for (const action of ACTIONS) {
      expect(decide(agent, action, ALICE_SESSION, { risk: "low", via: "tui", grant: { kind: "role", role: "guest" } })).toEqual({
        allow: false,
        reason: "agent_principal",
      })
    }
  })

  test("session actions without a (valid) session deny even for the scope owner", () => {
    for (const session of [null, undefined, { owner_user_id: "", collaborator_user_ids: [] }]) {
      expect(decide(owner(ALICE), "steer_session", session).reason).toBe("missing_session")
    }
    const broken = JSON.parse('{"owner_user_id":"u_000ALICE","collaborator_user_ids":"u_000BOB"}')
    expect(decide(trusted(BOB), "steer_session", broken).allow).toBe(false)
  })

  test("missing or unknown action detail denies", () => {
    expect(decide(owner(ALICE), "approve_risky_tool", ALICE_SESSION).reason).toBe("missing_risk")
    expect(decide(owner(ALICE), "approve_risky_tool", ALICE_SESSION, JSON.parse('{"risk":"critical"}')).reason).toBe("missing_risk")
    expect(decide(owner(ALICE), "set_rule", null).reason).toBe("missing_rule_target")
    expect(decide(owner(ALICE), "set_rule", null, JSON.parse('{"rule_target":{"kind":"galaxy"}}')).allow).toBe(false)
    expect(decide(owner(ALICE), "grant_role", null, { via: "dm" }).reason).toBe("missing_grant")
    expect(decide(member(ALICE), "set_rule", null, { rule_target: { kind: "thread", owner_user_id: null } }).allow).toBe(false)
  })
})

describe("grants", () => {
  test("a grant from a group chat is refused even for the scope owner", () => {
    const refused = decide(owner(ALICE), "grant_role", null, { via: "group", grant: { kind: "role", role: "member" } })
    expect(refused).toEqual({ allow: false, reason: "grant_outside_tui_or_dm" })
    expect(decide(owner(ALICE), "grant_role", null, { grant: { kind: "role", role: "member" } }).allow).toBe(false)
  })

  test("trusted cannot grant owner (nor any role, nor link codes for others)", () => {
    for (const role of ["owner", "trusted", "member", "guest"] as const) {
      expect(decide(trusted(ALICE), "grant_role", null, { via: "tui", grant: { kind: "role", role } }).allow).toBe(false)
    }
    expect(decide(trusted(ALICE), "grant_role", null, { via: "dm", grant: { kind: "link_code", for_user_id: BOB } }).allow).toBe(false)
  })

  test("the scope owner may grant every role up to owner, never an unknown one", () => {
    for (const role of ["owner", "trusted", "member", "guest"] as const) {
      expect(decide(owner(ALICE), "grant_role", null, { via: "dm", grant: { kind: "role", role } }).allow).toBe(true)
    }
    const unknownRole = JSON.parse('{"via":"dm","grant":{"kind":"role","role":"root"}}')
    expect(decide(owner(ALICE), "grant_role", null, unknownRole).reason).toBe("grant_above_role")
  })
})

describe("close / transfer a session (option A: session owner closes, only a scope owner transfers)", () => {
  const OWN = { owner_user_id: ALICE, collaborator_user_ids: [] }
  const FOREIGN = { owner_user_id: BOB, collaborator_user_ids: [] }

  test("session owner x transfer = deny: a member or trusted session owner needs a scope owner to transfer", () => {
    for (const actor of [member(ALICE), trusted(ALICE)]) {
      expect(decide(actor, "close_transfer_session", OWN, { session_op: "transfer" })).toEqual({ allow: false, reason: "transfer_needs_scope_owner" })
    }
  })

  test("session owner x close = allow: a member or trusted session owner closes their own session", () => {
    for (const actor of [member(ALICE), trusted(ALICE)]) {
      expect(decide(actor, "close_transfer_session", OWN, { session_op: "close" })).toEqual({ allow: true, reason: "allowed" })
      expect(decide(actor, "close_transfer_session", FOREIGN, { session_op: "close" })).toEqual({ allow: false, reason: "not_session_owner" })
    }
  })

  test("scope owner x transfer = allow, on their own session and on anyone else's", () => {
    for (const session of [OWN, FOREIGN]) {
      expect(decide(owner(ALICE), "close_transfer_session", session, { session_op: "transfer" })).toEqual({ allow: true, reason: "allowed" })
    }
  })

  test("a close/transfer request that does not say which denies for every role", () => {
    for (const actor of [member(ALICE), trusted(ALICE), owner(ALICE)]) {
      expect(decide(actor, "close_transfer_session", OWN).reason).toBe("missing_session_op")
      expect(decide(actor, "close_transfer_session", OWN, JSON.parse('{"session_op":"delete"}')).reason).toBe("missing_session_op")
    }
  })
})

describe("permissions never walk the parent pointer", () => {
  test("the owner of a parent gets no extra rights on a child whose owner differs (transfer case)", () => {
    const parent = createRequestedSession({ session_durable_id: "s_000PARENT", requester_user_id: ALICE, parent_session_durable_id: null, created_at: "2026-09-29T00:00:00.000Z" })
    const child = spawnSession(parent, { session_durable_id: "s_000CHILD", created_at: "2026-09-29T00:01:00.000Z" })
    expect(decide(member(ALICE), "steer_session", child).allow).toBe(true)

    const transferred = transferOwner(child, owner("u_000SCOPEOWNER"), BOB)
    if (!transferred.ok) throw new Error(`transfer refused: ${transferred.reason}`)
    expect(transferred.session.parent_session_durable_id).toBe("s_000PARENT")
    for (const actor of [member(ALICE), trusted(ALICE)]) {
      for (const action of ["steer_session", "invite_collaborator"] as const) {
        expect(decide(actor, action, transferred.session).allow).toBe(false)
      }
      expect(decide(actor, "close_transfer_session", transferred.session, { session_op: "close" }).reason).toBe("not_session_owner")
      expect(decide(actor, "approve_risky_tool", transferred.session, { risk: "low" }).allow).toBe(false)
      expect(decide(actor, "answer_question", transferred.session, { asked_user_id: BOB }).allow).toBe(false)
    }
    expect(decide(member(BOB), "steer_session", transferred.session).allow).toBe(true)
  })
})
