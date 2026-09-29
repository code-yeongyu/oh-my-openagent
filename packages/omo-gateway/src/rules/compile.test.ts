import { describe, expect, it } from "bun:test"
import { compileRules } from "./compile"
import type { RuleRecord } from "./format"
import { SESSION_UNIT_DEFAULTS } from "./gates"
import type { RuleCandidate } from "./resolve"

function candidate(n: number, overrides: Partial<RuleRecord>, seq = n): RuleCandidate {
  return {
    seq,
    rule: {
      id: `r_01J0000000000000000000${String(n).padStart(4, "0")}`,
      n,
      scope: { gateway: "acme", surface: null, chat: "C1", thread: null, user: null, agent: null },
      kind: "behavioral",
      gate: null,
      params: null,
      applies_to: ["lead", "worker"],
      set_by: "u_000ALICE",
      status: "active",
      supersedes: null,
      locked: false,
      text: `behavioral ${n}`,
      ...overrides,
    },
  }
}

describe("compileRules", () => {
  it("#given no rules #when compiled #then only the session_unit defaults are in force and the version passes through", () => {
    // given
    const version = "0123456789abcdef0123456789abcdef01234567"

    // when
    const compiled = compileRules([], { gateway: "acme", chat: "C1" }, version)

    // then
    expect(compiled).toEqual({ version, behavioral: [], gates: { session_unit: SESSION_UNIT_DEFAULTS } })
  })

  it("#given mechanical and behavioral rules #when compiled #then gates map to params in closed-set order and texts are listed", () => {
    // given
    const rules = [
      candidate(1, { kind: "mechanical", gate: "work_item_header", params: { template: "<@requester>: <line>" } }),
      candidate(2, { kind: "mechanical", gate: "language", params: { allow: ["en"] } }),
      candidate(3, { kind: "mechanical", gate: "session_unit", params: { notion: "page" } }),
      candidate(4, {}),
    ]

    // when
    const compiled = compileRules(rules, { gateway: "acme", chat: "C1" }, null)

    // then
    expect(Object.keys(compiled.gates)).toEqual(["language", "work_item_header", "session_unit"])
    expect(compiled.gates.language).toEqual({ allow: ["en"] })
    expect(compiled.gates.session_unit).toEqual({ ...SESSION_UNIT_DEFAULTS, notion: "page" })
    expect(compiled.behavioral).toEqual(["behavioral 4"])
  })
})
