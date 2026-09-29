import { describe, expect, test } from "bun:test"

import { canGrantRole, parseMatchRule, type RoleRuleRecord, resolveRole } from "./roles"

const SCOPE = "team"
const channel = (overrides: Record<string, unknown> = {}) => ({
  kind: "channel",
  platform: "slack",
  workspace: "T000TEST",
  chat: "C000WORK",
  parent_chat: null,
  author: "U000ALICE",
  dm: false,
  ...overrides,
})
const rule = (id: string, role: string, match: unknown, gatewayScope = SCOPE): RoleRuleRecord => ({ id, gateway_scope: gatewayScope, role, match })

describe("resolveRole", () => {
  test("the TUI is always owner, with or without rules", () => {
    expect(resolveRole([], SCOPE, { kind: "tui" })).toEqual({ role: "owner", rule_id: null, reason: "tui_owner" })
  })

  test("an unknown author is guest", () => {
    const rules = [rule("r1", "trusted", { kind: "channel", platform: "slack", workspace: "T000TEST", author: "U000ALICE" })]
    expect(resolveRole(rules, SCOPE, channel({ author: "U000MALLORY" }))).toEqual({ role: "guest", rule_id: null, reason: "no_rule_match" })
  })

  test("a missing or malformed origin is guest", () => {
    for (const origin of [null, undefined, {}, channel({ author: undefined }), channel({ author: "" }), channel({ workspace: 7 }), channel({ dm: "yes" }), { kind: "cron" }]) {
      expect(resolveRole([rule("r1", "owner", { kind: "channel", platform: "slack", workspace: "T000TEST" })], SCOPE, origin).role).toBe("guest")
    }
  })

  test("the highest matching role wins across rules", () => {
    const rules = [
      rule("r1", "member", { kind: "channel", platform: "slack", workspace: "T000TEST" }),
      rule("r2", "trusted", { kind: "channel", platform: "slack", workspace: "T000TEST", author: "U000ALICE" }),
    ]
    expect(resolveRole(rules, SCOPE, channel())).toEqual({ role: "trusted", rule_id: "r2", reason: "rule_match" })
    expect(resolveRole(rules, SCOPE, channel({ author: "U000BOB" })).role).toBe("member")
  })

  test("a thread inherits its parent channel's rule; parent_chat matches threads only", () => {
    const rules = [rule("r1", "member", { kind: "channel", platform: "discord", workspace: "G000TEST", chat: "C000PARENT" })]
    const thread = channel({ platform: "discord", workspace: "G000TEST", chat: "C000THREAD", parent_chat: "C000PARENT" })
    expect(resolveRole(rules, SCOPE, thread).role).toBe("member")

    const threadsOnly = [rule("r2", "trusted", { kind: "channel", platform: "discord", workspace: "G000TEST", parent_chat: "C000PARENT" })]
    expect(resolveRole(threadsOnly, SCOPE, thread).role).toBe("trusted")
    expect(resolveRole(threadsOnly, SCOPE, channel({ platform: "discord", workspace: "G000TEST", chat: "C000PARENT" })).role).toBe("guest")
  })

  test("rules of another scope, another platform or workspace, or another chat never match", () => {
    const origin = channel()
    expect(resolveRole([rule("r1", "owner", { kind: "channel", platform: "slack", workspace: "T000TEST" }, "other")], SCOPE, origin).role).toBe("guest")
    expect(resolveRole([rule("r1", "owner", { kind: "channel", platform: "discord", workspace: "T000TEST" })], SCOPE, origin).role).toBe("guest")
    expect(resolveRole([rule("r1", "owner", { kind: "channel", platform: "slack", workspace: "T000OTHER" })], SCOPE, origin).role).toBe("guest")
    expect(resolveRole([rule("r1", "owner", { kind: "channel", platform: "slack", workspace: "T000TEST", chat: "C000ELSE" })], SCOPE, origin).role).toBe("guest")
  })

  test("rules with an unknown role, a typo'd key, an empty field or a tui match never grant", () => {
    const base = { kind: "channel", platform: "slack", workspace: "T000TEST" }
    const bad = [
      rule("r1", "admin", base),
      rule("r2", "owner", { ...base, chatt: "C000WORK" }),
      rule("r3", "owner", { ...base, author: "" }),
      rule("r4", "owner", { kind: "channel", platform: "slack" }),
      rule("r5", "owner", { kind: "tui" }),
      rule("r6", "owner", "slack:T000TEST"),
    ]
    expect(resolveRole(bad, SCOPE, channel()).role).toBe("guest")
  })
})

describe("role tower", () => {
  test("a role grants only at or below its own rank", () => {
    expect(canGrantRole("trusted", "owner")).toBe(false)
    expect(canGrantRole("trusted", "trusted")).toBe(true)
    expect(canGrantRole("owner", "owner")).toBe(true)
    expect(canGrantRole("member", "trusted")).toBe(false)
  })

  test("parseMatchRule keeps only the known channel fields", () => {
    expect(parseMatchRule({ kind: "channel", platform: "slack", workspace: "T000TEST", chat: "C000WORK" })).toEqual({
      kind: "channel",
      platform: "slack",
      workspace: "T000TEST",
      chat: "C000WORK",
    })
    expect(parseMatchRule({ kind: "tui", role: "owner" })).toBeNull()
  })
})
