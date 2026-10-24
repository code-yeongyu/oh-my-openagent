/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { parseTeamCreateArgs } from "./lifecycle-inline-spec"

type ParsedInline = { inline_spec?: { name?: string; members?: unknown[] }; teamName?: string; leadSessionId?: string }

describe("team_create top-level spec coercion (#1)", () => {
  test("#given top-level {name, members} #when parsed #then folded into inline_spec", () => {
    // when
    const args = parseTeamCreateArgs({
      name: "probe-team",
      members: [{ name: "w", category: "quick", prompt: "do the assigned work" }],
    }) as ParsedInline

    // then
    expect(args.teamName).toBeUndefined()
    expect(args.inline_spec?.name).toBe("probe-team")
    expect(args.inline_spec?.members).toHaveLength(1)
  })

  test("#given top-level spec with leadSessionId #then leadSessionId is preserved outside inline_spec", () => {
    // when
    const args = parseTeamCreateArgs({
      name: "probe-team",
      members: [{ name: "w", category: "quick", prompt: "do the assigned work" }],
      leadSessionId: "ses_lead",
    }) as ParsedInline

    // then
    expect(args.leadSessionId).toBe("ses_lead")
    expect(args.inline_spec?.name).toBe("probe-team")
  })

  test("#given the documented inline_spec envelope #then it is left untouched", () => {
    // when
    const args = parseTeamCreateArgs({
      inline_spec: { name: "probe-team", members: [{ name: "w", category: "quick", prompt: "do the assigned work" }] },
    }) as ParsedInline

    // then
    expect(args.inline_spec?.name).toBe("probe-team")
  })

  test("#given teamName #then the named-team path still works", () => {
    // when
    const args = parseTeamCreateArgs({ teamName: "existing-team" }) as ParsedInline

    // then
    expect(args.teamName).toBe("existing-team")
    expect(args.inline_spec).toBeUndefined()
  })

  test("#given neither teamName nor members #then it still throws the usage error", () => {
    // then
    expect(() => parseTeamCreateArgs({ description: "no spec here" })).toThrow(/teamName or inline_spec/)
  })
})
