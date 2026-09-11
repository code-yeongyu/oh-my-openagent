import { describe, expect, test } from "bun:test"

import { toolArgTexts, ToolArgWindow } from "./recall-query-planner-tools"

describe("toolArgTexts", () => {
  test("extracts read paths and path words", () => {
    expect(toolArgTexts("read", { path: "/a/b/compaction-timeout.ts" })).toEqual([
      "compaction-timeout.ts", "compaction", "timeout",
    ])
  })

  test("extracts command tokens without flags", () => {
    const texts = toolArgTexts("bash", { command: "git rebase -i origin/dev | tee log.txt" })
    expect(texts).toContain("git")
    expect(texts).toContain("tee")
    expect(texts).toContain("log.txt")
    expect(texts).not.toContain("-i")
  })

  test("#given command git rebase -i origin/dev | tee log.txt #when toolArgTexts harvests it #then path words appear before git", () => {
    const texts = toolArgTexts("bash", { command: "git rebase -i origin/dev | tee log.txt" })
    const gitAt = texts.indexOf("git")
    const pathAt = texts.findIndex((text) => text === "log.txt" || text === "dev")
    expect(pathAt).toBeGreaterThanOrEqual(0)
    expect(gitAt).toBeGreaterThan(pathAt)
  })

  test("keeps grep patterns", () => {
    expect(toolArgTexts("grep", { pattern: "kibitzer nudged" })).toEqual(["kibitzer nudged"])
  })

  test("removes secret-bearing strings", () => {
    expect(toolArgTexts("bash", { command: "curl -H 'Authorization: Bearer sk-abcdef0123456789abcdef'" })).not.toContain("sk-abcdef0123456789abcdef")
  })

  test("ignores unknown keys and nested objects", () => {
    expect(toolArgTexts("read", { content: "hidden", text: "hidden", other: { path: "nested.ts" } })).toEqual([])
  })

  test("filters export secret command", () => {
    expect(toolArgTexts("bash", { command: "export TOKEN=abc123secretvalue00000" })).toEqual([])
  })

  test("#given eval code reading a file path #when toolArgTexts harvests it #then the file name and path words are kept", () => {
    const texts = toolArgTexts("eval", { code: "await Bun.file('/a/b/kibitzer-trigger.ts').text(); if (x) { y() }" })
    expect(texts).toContain("kibitzer-trigger.ts")
    expect(texts).toContain("kibitzer")
  })

  test("#given a bash command longer than 120 characters #when toolArgTexts harvests it #then the trailing path file name is kept", () => {
    const command = `${"echo ok | ".repeat(30)}cat /a/b/deep-file.ts`
    expect(command.length).toBeGreaterThanOrEqual(300)
    expect(toolArgTexts("bash", { command })).toContain("deep-file.ts")
  })

  test("#given eval code assigning an API key #when toolArgTexts harvests it #then secret material is absent", () => {
    const texts = toolArgTexts("eval", { code: "export TOKEN='sk-abcdef0123456789abcdef'" })
    expect(texts.some((token) => token.includes("sk-abcdef"))).toBe(false)
  })

  test("#given an eval summary mentioning a file #when toolArgTexts harvests it #then the summary and file name are kept", () => {
    const summary = "verify deadline salvage in packages/omo-senpi/x.ts"
    const texts = toolArgTexts("eval", { summary })
    expect(texts).toContain("x.ts")
    expect(texts).toContain(summary)
  })

  test("#given eval code with 100 distinct path tokens #when toolArgTexts harvests them #then at most 32 tokens are returned", () => {
    const code = Array.from({ length: 100 }, (_, index) => `cat /a/p${index}/n${index}.ts`).join("\n")
    expect(toolArgTexts("eval", { code }).length).toBeLessThanOrEqual(32)
  })
})

describe("ToolArgWindow", () => {
  test("keeps newest eight pushes and clears", () => {
    const window = new ToolArgWindow()
    for (let index = 0; index < 10; index += 1) window.push("session", [`text-${index}`])
    expect(window.texts("session")).toEqual(["text-2", "text-3", "text-4", "text-5", "text-6", "text-7", "text-8", "text-9"])
    window.clear("session")
    expect(window.texts("session")).toEqual([])
  })
})
