import { describe, expect, it } from "bun:test"
import type { RuleRecord, RuleScope } from "./format"
import { resolveRules, type RuleCandidate, type ResolveTarget } from "./resolve"

let counter = 0

function rule(overrides: Partial<Omit<RuleRecord, "scope">> & { scope?: Partial<RuleScope> }, seq: number): RuleCandidate {
  counter += 1
  const { scope, ...rest } = overrides
  return {
    seq,
    rule: {
      id: `r_01J00000000000000000000${String(counter).padStart(3, "0")}`,
      n: counter,
      scope: { gateway: "acme", surface: null, chat: null, thread: null, user: null, agent: null, ...scope },
      kind: "mechanical",
      gate: "language",
      params: { allow: ["en"] },
      applies_to: ["lead", "worker"],
      set_by: "u_000ALICE",
      status: "active",
      supersedes: null,
      locked: false,
      text: `rule ${counter}`,
      ...rest,
    },
  }
}

const IN_C1: ResolveTarget = { gateway: "acme", surface: "slack:T000TEST", chat: "C1", thread: "1700000000.000100", requester: "u_000ALICE" }

describe("resolveRules", () => {
  it("#given a scope-wide and a channel rule for one gate #when resolved in that channel #then the channel rule wins", () => {
    // given
    const scopeWide = rule({ params: { allow: ["en"] } }, 2)
    const channel = rule({ scope: { chat: "C1" }, params: { allow: ["en", "ko"] } }, 1)

    // when
    const resolved = resolveRules([scopeWide, channel], IN_C1)

    // then
    expect(resolved.gates.get("language")?.params).toEqual({ allow: ["en", "ko"] })
    expect(resolved.gates.get("language")?.rules).toEqual([channel.rule])
  })

  it("#given a locked scope-wide rule and a channel rule #when resolved in that channel #then the locked rule wins", () => {
    // given
    const locked = rule({ params: { allow: ["en"] }, locked: true }, 1)
    const channel = rule({ scope: { chat: "C1" }, params: { allow: ["ko"] } }, 2)
    const thread = rule({ scope: { chat: "C1", thread: "1700000000.000100" }, params: { allow: ["ja"] } }, 3)

    // when
    const resolved = resolveRules([locked, channel, thread], IN_C1)

    // then
    expect(resolved.gates.get("language")?.params).toEqual({ allow: ["en"] })
  })

  it("#given a revoked and a superseded rule #when resolved #then neither is in force", () => {
    // given
    const revoked = rule({ scope: { chat: "C1" }, params: { allow: ["ko"] }, status: "revoked" }, 3)
    const old = rule({ scope: { chat: "C1" }, kind: "behavioral", gate: null, params: null, text: "old wording" }, 1)
    const replacement = rule({ kind: "behavioral", gate: null, params: null, text: "new wording", supersedes: old.rule.id }, 2)
    const scopeWide = rule({ params: { allow: ["en"] } }, 1)

    // when
    const resolved = resolveRules([revoked, old, replacement, scopeWide], IN_C1)

    // then
    expect(resolved.gates.get("language")?.params).toEqual({ allow: ["en"] })
    expect(resolved.behavioral.map(({ rule: entry }) => entry.text)).toEqual(["new wording"])
  })

  it("#given user rules of a participant and of an outsider #when resolved #then only the participant's rule is included", () => {
    // given
    const participant = rule({ scope: { user: "u_000BOB" }, kind: "behavioral", gate: null, params: null, text: "tag Bob on status" }, 1)
    const outsider = rule({ scope: { user: "u_000CAROL" }, kind: "behavioral", gate: null, params: null, text: "tag Carol" }, 2)

    // when
    const resolved = resolveRules([participant, outsider], { ...IN_C1, participants: ["u_000BOB"] })

    // then
    expect(resolved.behavioral.map(({ rule: entry }) => entry.text)).toEqual(["tag Bob on status"])
  })

  it("#given rules at every level #when resolved #then behavioral rules come most specific first and gate ties go to the newest", () => {
    // given
    const scopeWide = rule({ kind: "behavioral", gate: null, params: null, text: "scope" }, 5)
    const surface = rule({ scope: { surface: "slack:T000TEST" }, kind: "behavioral", gate: null, params: null, text: "surface" }, 4)
    const chat = rule({ scope: { chat: "C1" }, kind: "behavioral", gate: null, params: null, text: "chat" }, 1)
    const requester = rule({ scope: { chat: "C1", user: "u_000ALICE" }, kind: "behavioral", gate: null, params: null, text: "chat+requester" }, 2)
    const olderTie = rule({ scope: { chat: "C1" }, params: { allow: ["de"] } }, 1)
    const newerTie = rule({ scope: { chat: "C1" }, params: { allow: ["fr"] } }, 9)

    // when
    const resolved = resolveRules([scopeWide, surface, chat, requester, olderTie, newerTie], IN_C1)

    // then
    expect(resolved.behavioral.map(({ rule: entry }) => entry.text)).toEqual(["chat+requester", "chat", "surface", "scope"])
    expect(resolved.gates.get("language")?.params).toEqual({ allow: ["fr"] })
  })

  it("#given rules for another chat, gateway or audience #when resolved #then they do not apply", () => {
    // given
    const otherChat = rule({ scope: { chat: "C2" } }, 1)
    const otherGateway = rule({ scope: { gateway: "other" } }, 1)
    const leadOnly = rule({ applies_to: ["lead"], gate: "decision_nag", params: {} }, 1)
    const workerAgent = rule({ scope: { agent: "worker" }, gate: "progress_edit", params: {} }, 1)

    // when
    const asWorker = resolveRules([otherChat, otherGateway, leadOnly, workerAgent], { ...IN_C1, audience: "worker" })
    const asLead = resolveRules([leadOnly, workerAgent], { ...IN_C1, audience: "lead" })

    // then
    expect([...asWorker.gates.keys()]).toEqual(["progress_edit"])
    expect([...asLead.gates.keys()]).toEqual(["decision_nag"])
  })

  it("#given session_unit rules at two levels #when resolved #then each platform key takes its most specific setter", () => {
    // given
    const scopeWide = rule({ gate: "session_unit", params: { slack: "chat", telegram: "chat" } }, 2)
    const channel = rule({ scope: { chat: "C1" }, gate: "session_unit", params: { slack: "thread" } }, 1)
    const lockedNotion = rule({ gate: "session_unit", params: { notion: "page" }, locked: true }, 1)
    const channelNotion = rule({ scope: { chat: "C1" }, gate: "session_unit", params: { notion: "discussion" } }, 3)

    // when
    const resolved = resolveRules([scopeWide, channel, lockedNotion, channelNotion], IN_C1)

    // then
    expect(resolved.gates.get("session_unit")?.params).toEqual({ slack: "thread", telegram: "chat", notion: "page" })
  })
})
