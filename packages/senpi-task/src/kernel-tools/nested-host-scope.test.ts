import { describe, expect, test } from "bun:test"

import { childEffectiveToolNames, escalatingHostTools, isWriteCapableHostTool } from "./nested-host-scope"

// The child's structurally-visible surface: shared parent tools minus UI-only names minus the
// task/team family. Session builtins are unioned by the shared childStructuralToolNames function.
const CHILD_TOOLS = ["read", "grep", "ls", "web_search", "write", "edit", "bash", "lsp_symbols", "lsp_rename"]

describe("nested host scope classification", () => {
  test("#given host tool names #when classified #then only read and interaction tools are non-write", () => {
    expect(["read", "grep", "ls", "web_search", "lsp_symbols", "ask_user_question"].every((name) => !isWriteCapableHostTool(name))).toBe(true)
    expect(["write", "edit", "bash", "memory", "lsp_rename", "mcp_unknown_tool"].every(isWriteCapableHostTool)).toBe(true)
  })

  test("#given a policy #when the effective set is computed #then it is the visible surface minus deny, intersected with allow", () => {
    expect(childEffectiveToolNames({ childToolNames: CHILD_TOOLS, toolDenylist: ["write"] })).not.toContain("write")
    expect(childEffectiveToolNames({ childToolNames: CHILD_TOOLS, toolAllowlist: ["read"] })).toEqual(["read"])
    expect(childEffectiveToolNames({ childToolNames: ["x_search"] })).toEqual(["read", "bash", "edit", "write", "grep", "x_search"])
    expect(childEffectiveToolNames({ childToolNames: [], toolAllowlist: ["read"] })).toEqual(["read"])
  })
})

describe("nested host scope rule", () => {
  test("#given a child with no policy of its own #when checked #then nothing escalates", () => {
    expect(escalatingHostTools({ childToolNames: CHILD_TOOLS })).toEqual([])
    expect(escalatingHostTools({ childToolNames: CHILD_TOOLS, toolDenylist: [] })).toEqual([])
  })

  test("#given an EMPTY allowlist (the most restrictive shape) #when checked #then every write-capable parent tool escalates", () => {
    expect(escalatingHostTools({ childToolNames: CHILD_TOOLS, toolAllowlist: [] })).toEqual(["bash", "edit", "write", "lsp_rename"])
    // `tools: { write: false }` in omo.json resolves to exactly this pair.
    expect(escalatingHostTools({ childToolNames: ["fixture_write"], toolAllowlist: [], toolDenylist: ["write"] })).toContain("write")
  })

  test("#given a denylist #when it removes a write-capable tool #then that tool escalates, and a read-only denial does not", () => {
    expect(escalatingHostTools({ childToolNames: CHILD_TOOLS, toolDenylist: ["write", "edit"] })).toEqual(["edit", "write"])
    expect(escalatingHostTools({ childToolNames: CHILD_TOOLS, toolDenylist: ["web_search", "grep"] })).toEqual([])
  })

  test("#given an allowlist #when it omits a write-capable parent tool #then that tool escalates", () => {
    expect(escalatingHostTools({ childToolNames: CHILD_TOOLS, toolAllowlist: ["read", "grep", "bash", "write"] })).toEqual(["edit", "lsp_rename"])
    expect(escalatingHostTools({ childToolNames: CHILD_TOOLS, toolAllowlist: CHILD_TOOLS })).toEqual([])
  })

  test("#given a host-wide exclusion #when the child never had the tool #then it does not escalate, because the exclusion is not a permission reduction", () => {
    // `memory` and `ask_user_question` are UI/identity-bound and the task/team family is withheld
    // from every child; neither is in the child's visible set, so neither can escalate.
    expect(escalatingHostTools({ childToolNames: CHILD_TOOLS, toolDenylist: ["memory", "ask_user_question", "task"] })).toEqual([])
    expect(escalatingHostTools({ childToolNames: ["read", "task", "workpool", "team_send"], toolAllowlist: ["read", "write", "edit", "bash"] })).toEqual([])
  })

  test("#given an unknown child surface #when a policy exists #then the session builtins are still checked", () => {
    expect(escalatingHostTools({ toolDenylist: ["write"] })).toEqual(["write"])
    expect(escalatingHostTools({ childToolNames: [], toolAllowlist: ["read"] })).toEqual(["bash", "edit", "write"])
    expect(escalatingHostTools({ toolDenylist: ["web_search"] })).toEqual([])
  })
})
