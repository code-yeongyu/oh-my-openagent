import { describe, expect, test } from "bun:test"

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, type ExtensionContext } from "@code-yeongyu/senpi"

import {
  createCuratedReadonlyBashTool,
  CuratedReadonlyCommandError,
  planCuratedReadonlyCommand,
} from "./curated-readonly-bash"

async function executeFakeGitHub(endpoint: "bytes" | "error" | "lines" | "small"): Promise<string> {
  const tool = createCuratedReadonlyBashTool("/fixture", async () => {
    if (endpoint === "lines") return Array.from({ length: 2_501 }, (_, index) => `row ${index}`).join("\n")
    if (endpoint === "bytes") return "x".repeat(60_000)
    if (endpoint === "error") {
      throw new CuratedReadonlyCommandError(`Read-only gh request failed: ${"e".repeat(100_000)}`)
    }
    return "line one\nline two"
  })
  const result = await tool.execute(
    "call-1",
    { program: "gh", args: ["api", endpoint] },
    undefined,
    undefined,
    {} as unknown as ExtensionContext,
  )
  const [part] = result.content
  if (part?.type !== "text") throw new Error("expected a text tool result")
  return part.text
}

describe("createCuratedReadonlyBashTool", () => {
  test("#given output beyond the line limit #when the tool returns #then it keeps the head and reports truncation", async () => {
    const result = await executeFakeGitHub("lines")

    expect(result.startsWith("row 0\nrow 1\n")).toBe(true)
    expect(result).toContain("[truncated:")
    expect(result).not.toContain("row 2500")
    expect(result.split("\n").length).toBeLessThanOrEqual(DEFAULT_MAX_LINES)
  })

  test("#given output beyond the byte limit #when the tool returns #then it is bounded and reports truncation", async () => {
    const result = await executeFakeGitHub("bytes")

    expect(Buffer.byteLength(result)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES)
    expect(result.startsWith("x".repeat(1_024))).toBe(true)
    expect(result).toContain("[truncated:")
  })

  test("#given failed output beyond the byte limit #when the tool rejects #then the diagnostic head is retained within budget", async () => {
    let message = ""
    try {
      await executeFakeGitHub("error")
    } catch (error) {
      if (!(error instanceof Error)) throw error
      message = error.message
    }

    expect(Buffer.byteLength(message)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES)
    expect(message.startsWith(`Read-only gh request failed: ${"e".repeat(1_024)}`)).toBe(true)
    expect(message).toContain("[truncated:")
  })

  test("#given output within both limits #when the tool returns #then it stays byte-identical", async () => {
    expect(await executeFakeGitHub("small")).toBe("line one\nline two")
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
