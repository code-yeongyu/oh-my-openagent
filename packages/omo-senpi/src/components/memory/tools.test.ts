import { describe, expect, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { MemoryIdentityContext } from "./context"
import {
  MEMORY_APPLY_PATCH_TOOL_NAME,
  MEMORY_TOOL_NAME,
  createMemoryTools,
  registerMemoryTools,
} from "./tools"
import { boundFixture, textOf } from "./tools.test-support"

describe("memory tool registration", () => {
  test("#given a context resolver #when registerMemoryTools runs #then both tools are captured with sequential execution and prompt metadata", () => {
    // given
    const pi = new FakeExtensionAPI()

    // when
    registerMemoryTools(pi, () => undefined)

    // then
    const names = pi.tools.map((tool) => tool["name"])
    expect(names).toEqual([MEMORY_TOOL_NAME, MEMORY_APPLY_PATCH_TOOL_NAME])
    for (const tool of pi.tools) {
      expect(tool["executionMode"]).toBe("sequential")
      expect(typeof tool["label"]).toBe("string")
      expect(typeof tool["description"]).toBe("string")
      expect(typeof tool["promptSnippet"]).toBe("string")
      const guidelines = tool["promptGuidelines"]
      expect(Array.isArray(guidelines)).toBe(true)
      expect((guidelines as readonly unknown[]).length).toBeGreaterThan(0)
      expect(typeof tool["parameters"]).toBe("object")
      expect(typeof tool["execute"]).toBe("function")
    }
  })

  test("#given the memory tool description #when inspected #then it documents omo identity, frontmatter rules, and result strings", () => {
    // given
    const pi = new FakeExtensionAPI()
    registerMemoryTools(pi, () => undefined)

    // when
    const description = String(pi.tools[0]?.["description"] ?? "")

    // then
    expect(description).toContain("memory repo")
    expect(description).toContain("frontmatter")
    expect(description).toContain("read_only")
    expect(description).toContain("harness will sync after the turn")
  })
})

describe("memory tool activation", () => {
  test("#given no bound identity #when either tool executes #then an actionable initialization error is returned", async () => {
    // given
    const [memoryTool, applyPatchTool] = createMemoryTools(() => undefined)

    // when
    const memoryResult = await memoryTool.execute("call-1", { command: "create", reason: "x", file_path: "a.md", description: "d" })
    const patchResult = await applyPatchTool.execute("call-2", { reason: "x", input: "*** Begin Patch\n*** End Patch" })

    // then
    expect(memoryResult.isError).toBe(true)
    expect(textOf(memoryResult)).toContain("no memory identity bound")
    expect(textOf(memoryResult)).toContain("restart")
    expect(patchResult.isError).toBe(true)
    expect(textOf(patchResult)).toContain("no memory identity bound")
  })

  test("#given a resolver that binds after registration #when the tool executes #then activation follows binding", async () => {
    // given
    const fixture = await boundFixture()
    const holder: { current: MemoryIdentityContext | undefined } = { current: undefined }
    const [memoryTool] = createMemoryTools(() => holder.current)

    // when
    const stale = await memoryTool.execute("call-1", { command: "create", reason: "early", file_path: "a.md", description: "d" })
    holder.current = fixture.context
    const bound = await memoryTool.execute("call-2", { command: "create", reason: "Track a", file_path: "a.md", description: "d" })

    // then
    expect(stale.isError).toBe(true)
    expect(bound.isError).toBeUndefined()
  })
})
