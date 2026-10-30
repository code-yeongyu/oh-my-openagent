import { describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { ChildSpec } from "@oh-my-opencode/senpi-task"

import { KIBITZER_SIDECAR_TOOL_NAMES, MemoryToolOperations } from "./index"
import { commitMemory, harness, jsonOf, memoryRepo, message, sessionContext, tempRoot, textOf } from "./test-support"

async function workspace(): Promise<string> {
  const root = await tempRoot("omo-kibitzer-ws-")
  await mkdir(join(root, "src"), { recursive: true })
  await writeFile(join(root, "src", "app.ts"), "export const token = 'value'\nexport const other = 1\n", "utf8")
  return root
}

describe("createKibitzerSidecarTools registry", () => {
  test("#given the sidecar tool set #when created #then exactly the five read-only names are registered with no aliases", async () => {
    const root = await workspace()
    const repo = await memoryRepo()
    const h = harness({ workspaceRoot: root, repo })

    const names = h.tools.map((tool) => tool.name)
    expect(names).toEqual(["read", "grep", "session_entries", "memory", "nudge"])
    expect(names).toEqual([...KIBITZER_SIDECAR_TOOL_NAMES])
    const memberScoped: ChildSpec["memberScopedTools"] = h.tools
    expect(memberScoped).toHaveLength(5)
    expect(new Set(names).size).toBe(5)
    expect(names).not.toContain("memory_search")
    expect(names).not.toContain("memory_read")
    for (const forbidden of ["bash", "find", "ls", "edit", "write"]) expect(names).not.toContain(forbidden)
  })

  test("#given the memory tool #when its schema is inspected #then only search and read operations exist", async () => {
    const root = await workspace()
    const repo = await memoryRepo()
    const h = harness({ workspaceRoot: root, repo })

    expect([...MemoryToolOperations]).toEqual(["search", "read"])
    const memory = h.tools.find((tool) => tool.name === "memory")
    const schema = JSON.stringify(memory?.parameters)
    expect(schema).toContain('"search"')
    expect(schema).toContain('"read"')
    for (const write of ["create", "str_replace", "insert", "delete", "rename", "update_description", "apply_patch"]) {
      expect(schema).not.toContain(`"${write}"`)
    }
  })

  test("#given a per-wake budget #when each tool executes #then every call charges the budget once", async () => {
    const root = await workspace()
    const repo = await memoryRepo()
    await commitMemory(repo, "notes/deploy.md", "Deploy with bun build before tagging.")
    const h = harness({ workspaceRoot: root, repo, budgetLimit: 8 })
    h.snapshot.refresh(sessionContext([message("user", "hello", "e1")]))
    h.offered.add("notes/deploy.md")

    await h.call("read", { path: "src/app.ts" })
    expect(h.budget.used).toBe(1)
    await h.call("grep", { pattern: "other" })
    expect(h.budget.used).toBe(2)
    await h.call("session_entries", { since: -1 })
    expect(h.budget.used).toBe(3)
    await h.call("memory", { operation: "search", query: "deploy" })
    expect(h.budget.used).toBe(4)
    await h.call("memory", { operation: "read", path: "notes/deploy.md" })
    expect(h.budget.used).toBe(5)
    await h.call("nudge", { path: "notes/deploy.md", hint: "Deploy runs bun build before tagging." })
    expect(h.budget.used).toBe(6)
    expect(h.accepted).toEqual([{ path: "notes/deploy.md", hint: "Deploy runs bun build before tagging." }])
  })

  test("#given an exhausted budget #when any tool is called #then it returns a structured tool_budget_exceeded rejection", async () => {
    const root = await workspace()
    const repo = await memoryRepo()
    const h = harness({ workspaceRoot: root, repo, budgetLimit: 1 })

    const first = await h.call("read", { path: "src/app.ts" })
    expect(first.isError).toBeUndefined()
    const second = await h.call("read", { path: "src/app.ts" })
    expect(second.isError).toBe(true)
    expect(jsonOf(second)).toMatchObject({ rejected: "tool_budget_exceeded" })
    expect(h.budget.used).toBe(1)
  })

  test("#given a read cap #when a file exceeds it #then the output is truncated with a marker and secrets are redacted", async () => {
    const root = await workspace()
    await writeFile(join(root, "src", "big.ts"), `const key = "api_key=sk-abcdef1234567890"\n${"x".repeat(500)}\n`, "utf8")
    const repo = await memoryRepo()
    const h = harness({ workspaceRoot: root, repo, caps: { readChars: 120 } })

    const result = await h.call("read", { path: "src/big.ts" })
    const text = textOf(result)
    expect(text).not.toContain("sk-abcdef1234567890")
    expect(text).toContain("[truncated")
    expect(text.length).toBeLessThanOrEqual(120 + 64)
  })

  test("#given a grep cap #when matches exceed it #then at most the cap is returned and the result says so", async () => {
    const root = await workspace()
    await writeFile(join(root, "src", "many.ts"), Array.from({ length: 20 }, (_, i) => `needle ${i}`).join("\n"), "utf8")
    const repo = await memoryRepo()
    const h = harness({ workspaceRoot: root, repo, caps: { grepMatches: 5 } })

    const result = jsonOf(await h.call("grep", { pattern: "needle" }))
    expect(result.matches).toHaveLength(5)
    expect(result.truncated).toBe(true)
  })
})
