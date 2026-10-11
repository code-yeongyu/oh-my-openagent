/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { writeAgentMarkdown } from "./agent-markdown"

describe("writeAgentMarkdown", () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs.length = 0
  })

  function tempAgentDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), "agent-markdown-test-"))
    dirs.push(directory)
    return directory
  }

  const junior = { description: "Focused task executor.", mode: "subagent", prompt: "work" }
  const agents = {
    "Sisyphus-Junior": junior,
    "sisyphus-junior": { ...junior, hidden: true },
  }

  it("writes one file once when two names differ only by case", () => {
    // given
    const directory = tempAgentDirectory()

    // when
    const first = writeAgentMarkdown({ directory, agents, caseInsensitivePaths: true })
    const second = writeAgentMarkdown({ directory, agents, caseInsensitivePaths: true })

    // then
    expect(first.filter((agent) => agent.changed).map((agent) => agent.name)).toEqual(["sisyphus-junior"])
    expect(first.map((agent) => agent.name).sort()).toEqual(["Sisyphus-Junior", "sisyphus-junior"])
    expect(second.some((agent) => agent.changed)).toBe(false)
    const files = readdirSync(directory)
    expect(files.length).toBe(1)
    expect(readFileSync(join(directory, files[0] ?? ""), "utf8")).toContain("hidden: true")
  })

  it("is stable across boots for names that do not collide", () => {
    // given
    const directory = tempAgentDirectory()
    const distinct = { atlas: { ...junior, hidden: true }, "Atlas - Plan Executor": junior }

    // when
    writeAgentMarkdown({ directory, agents: distinct, caseInsensitivePaths: true })
    const second = writeAgentMarkdown({ directory, agents: distinct, caseInsensitivePaths: true })

    // then
    expect(second.map((agent) => agent.changed)).toEqual([false, false])
    expect(readdirSync(directory).length).toBe(2)
  })
})
