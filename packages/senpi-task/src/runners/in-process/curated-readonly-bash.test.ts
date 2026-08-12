import { describe, expect, test } from "bun:test"

import type { ExtensionContext } from "@code-yeongyu/senpi"

import { capResultText, createCuratedReadonlyBashTool, planCuratedReadonlyCommand } from "./curated-readonly-bash"

describe("createCuratedReadonlyBashTool", () => {
  test("#given a retrieval returning a whole large page #when the tool runs #then the tool result is capped", async () => {
    // given a fetch answering with a blocked-request page the size of the one that killed the lanes
    const page = "x".repeat(190_000)
    const tool = createCuratedReadonlyBashTool("/tmp", () => Promise.resolve(page))

    // when
    const result = await tool.execute(
      "call-1",
      { program: "curl", args: ["--silent", "https://example.com/big"] },
      undefined,
      undefined,
      {} as unknown as ExtensionContext,
    )

    // then
    const [part] = result.content
    expect(part?.type).toBe("text")
    expect(part?.type === "text" && part.text.length).toBeLessThan(page.length / 3)
  })
})

describe("capResultText", () => {
  test("#given a result within the limits #when capped #then it is returned unchanged", () => {
    // given
    const text = "line one\nline two"

    // when
    const result = capResultText(text)

    // then
    expect(result).toBe(text)
  })

  test("#given a retrieval far larger than the byte limit #when capped #then it is cut down and says so", () => {
    // given a single-line document the size of a blocked-request HTML page
    const text = "x".repeat(190_000)

    // when
    const result = capResultText(text)

    // then
    expect(result.length).toBeLessThan(text.length / 3)
    expect(result).toContain("[truncated:")
  })

  test("#given a result past the line limit #when capped #then the surviving lines lead the result", () => {
    // given
    const text = Array.from({ length: 5_000 }, (_line, index) => `row ${index}`).join("\n")

    // when
    const result = capResultText(text)

    // then
    expect(result.startsWith("row 0\nrow 1\n")).toBe(true)
    expect(result).toContain("[truncated:")
    expect(result).not.toContain("row 4999")
  })
})

describe("planCuratedReadonlyCommand", () => {
  test("#given read-only curl and GitHub requests #when planned #then direct executables are returned without a shell", () => {
    expect(planCuratedReadonlyCommand({ program: "curl", args: ["--silent", "https://example.com/docs"] })).toEqual({
      program: "curl",
      args: ["--disable", "--silent", "https://example.com/docs"],
    })
    expect(planCuratedReadonlyCommand({ program: "gh", args: ["search", "code", "createTaskEngine", "--limit", "5"] })).toEqual({
      program: "gh",
      args: ["search", "code", "createTaskEngine", "--limit", "5"],
    })
  })

  test("#given mutation-capable flags or commands #when planned #then every request is rejected", () => {
    const requests = [
      { program: "curl", args: ["--request", "POST", "https://example.com"] },
      { program: "curl", args: ["--output", "artifact", "https://example.com"] },
      { program: "curl", args: ["--data", "x=1", "https://example.com"] },
      { program: "gh", args: ["api", "repos/acme/repo", "--method", "DELETE"] },
      { program: "gh", args: ["repo", "clone", "acme/repo"] },
    ] as const

    for (const request of requests) {
      expect(() => planCuratedReadonlyCommand(request)).toThrow("read-only")
    }
  })
})
