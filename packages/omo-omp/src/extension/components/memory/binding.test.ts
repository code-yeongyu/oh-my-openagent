import { describe, expect, test } from "bun:test"

import { MEMORY_BINDING_CUSTOM_TYPE, createMemoryBinding, findLatestMemoryBinding } from "./binding"

describe("memory binding", () => {
  test("#given an identity repo and clock #when a binding is created #then it carries a stable path hash without exposing the path", () => {
    const binding = createMemoryBinding({ identity: "agent-123", repoPath: "/private/memory/repo", boundAt: 42 })

    expect(binding).toEqual({ identity: "agent-123", repoPathHash: expect.stringMatching(/^[a-f0-9]{64}$/), boundAt: 42 })
    expect(JSON.stringify(binding)).not.toContain("/private/memory/repo")
  })

  test("#given multiple session entries #when the latest valid binding is found #then malformed and older bindings are ignored", () => {
    const latest = findLatestMemoryBinding([
      { type: "custom", customType: MEMORY_BINDING_CUSTOM_TYPE, data: { identity: "old", repoPathHash: "a", boundAt: 1 } },
      { type: "custom", customType: MEMORY_BINDING_CUSTOM_TYPE, data: { identity: 1 } },
      { type: "custom", customType: MEMORY_BINDING_CUSTOM_TYPE, data: { identity: "new", repoPathHash: "b", boundAt: 2 } },
    ])

    expect(latest).toEqual({ identity: "new", repoPathHash: "b", boundAt: 2 })
  })
})
