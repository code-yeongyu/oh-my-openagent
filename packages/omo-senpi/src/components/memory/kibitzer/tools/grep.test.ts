import { describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { createNodeGitExec, type GitExec } from "@oh-my-opencode/memory-core"

import { createWakeToolBudget } from "./budget"
import { resolveKibitzerToolCaps, type KibitzerToolCaps } from "./caps"
import { createKibitzerGrepTool } from "./grep"
import type { KibitzerToolResult } from "./result"
import { tempRoot } from "./test-support"

interface GrepOptions {
  readonly root: string
  readonly caps?: Partial<KibitzerToolCaps>
  readonly now?: () => number
  readonly git?: GitExec
}

function grepTool(options: GrepOptions) {
  const budget = createWakeToolBudget(16)
  return createKibitzerGrepTool({
    workspaceRoot: options.root,
    caps: resolveKibitzerToolCaps(options.caps),
    budget: () => budget,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.git === undefined ? {} : { git: options.git }),
  })
}

function textOf(result: KibitzerToolResult): string {
  const first = result.content[0]
  return first !== undefined && first.type === "text" ? first.text : ""
}

function jsonOf(result: KibitzerToolResult): Record<string, unknown> {
  return JSON.parse(textOf(result)) as Record<string, unknown>
}

function matchPaths(result: KibitzerToolResult): string[] {
  const matches = jsonOf(result).matches as { path: string }[]
  return matches.map((match) => match.path)
}

/** Two files, one nested, both matching `needle` exactly once. */
async function smallTree(): Promise<string> {
  const root = await tempRoot("omo-kibitzer-grep-")
  await mkdir(join(root, "src"), { recursive: true })
  await writeFile(join(root, "a.txt"), "alpha needle\nbeta\n", "utf8")
  await writeFile(join(root, "src", "app.ts"), "export const token = 'value'\nexport const other = 1\nneedle here\n", "utf8")
  return root
}

/** `count` sibling files named a.txt, b.txt, ... each holding one matching line. */
async function flatTree(count: number, line = "needle\n"): Promise<string> {
  const root = await tempRoot("omo-kibitzer-grep-")
  for (let index = 0; index < count; index += 1) {
    await writeFile(join(root, `${String.fromCharCode(97 + index)}.txt`), line, "utf8")
  }
  return root
}

async function gitInit(root: string): Promise<void> {
  const result = await createNodeGitExec().run(["init"], { cwd: root, timeoutMs: 30_000 })
  expect(result.code).toBe(0)
}

// Captured from the pre-change implementation (walk + full read, no budgets) on `smallTree()`.
const SMALL_TREE_JSON =
  '{"matches":[{"path":"a.txt","line":1,"text":"alpha needle"},{"path":"src/app.ts","line":3,"text":"needle here"}],"truncated":false}'

describe("kibitzer grep budgets", () => {
  test("#given a tree inside every budget #when grep runs #then the result is byte-identical to the pre-change output", async () => {
    const tool = grepTool({ root: await smallTree() })

    const result = await tool.execute("call-1", { pattern: "needle" })

    expect(textOf(result)).toBe(SMALL_TREE_JSON)
  })

  test("#given a git workspace with nothing ignored #when grep runs #then the result is byte-identical to the walk output", async () => {
    const root = await smallTree()
    await gitInit(root)
    const tool = grepTool({ root })

    const result = await tool.execute("call-1", { pattern: "needle" })

    expect(textOf(result)).toBe(SMALL_TREE_JSON)
  })

  test("#given more files than the file budget #when grep runs #then it stops at files and keeps the matches scanned so far", async () => {
    const tool = grepTool({ root: await flatTree(3), caps: { grepScanFiles: 2 } })

    const result = await tool.execute("call-1", { pattern: "needle" })

    expect(matchPaths(result)).toEqual(["a.txt", "b.txt"])
    expect(jsonOf(result)).toMatchObject({ truncated: true, stopped: "files" })
  })

  test("#given a byte budget smaller than the tree #when grep runs #then it stops at bytes after the file it already read", async () => {
    const tool = grepTool({ root: await flatTree(3), caps: { grepScanBytes: 1 } })

    const result = await tool.execute("call-1", { pattern: "needle" })

    expect(matchPaths(result)).toEqual(["a.txt"])
    expect(jsonOf(result)).toMatchObject({ truncated: true, stopped: "bytes" })
  })

  test("#given a clock past the time budget #when grep runs #then it stops at time with the matches found so far", async () => {
    // Every budget check reads the clock once; a 400ms step trips the 1000ms budget after the first file.
    let elapsed = 0
    const tool = grepTool({ root: await flatTree(3), caps: { grepScanMs: 1000 }, now: () => (elapsed += 400) })

    const result = await tool.execute("call-1", { pattern: "needle" })

    expect(matchPaths(result)).toEqual(["a.txt"])
    expect(jsonOf(result)).toMatchObject({ truncated: true, stopped: "time" })
  })

  test("#given an already aborted turn #when grep runs #then it stops at aborted without reading a file", async () => {
    const tool = grepTool({ root: await flatTree(3) })
    const controller = new AbortController()
    controller.abort()

    const result = await tool.execute("call-1", { pattern: "needle" }, controller.signal)

    expect(jsonOf(result)).toEqual({ matches: [], truncated: true, stopped: "aborted" })
  })

  test("#given a turn aborted mid-scan #when grep runs #then it stops at aborted and keeps the matches found so far", async () => {
    // The clock is read once per file before it is scanned; aborting on the third read lands
    // between the first and the second file.
    const controller = new AbortController()
    let reads = 0
    const tool = grepTool({
      root: await flatTree(3),
      now: () => {
        reads += 1
        if (reads >= 3) controller.abort()
        return 0
      },
    })

    const result = await tool.execute("call-1", { pattern: "needle" }, controller.signal)

    expect(matchPaths(result)).toEqual(["a.txt"])
    expect(jsonOf(result)).toMatchObject({ truncated: true, stopped: "aborted" })
  })

  test("#given more matches than the match cap #when grep runs #then it stops at matches", async () => {
    const tool = grepTool({ root: await flatTree(3), caps: { grepMatches: 2 } })

    const result = await tool.execute("call-1", { pattern: "needle" })

    expect(matchPaths(result)).toEqual(["a.txt", "b.txt"])
    expect(jsonOf(result)).toMatchObject({ truncated: true, stopped: "matches" })
  })
})

describe("kibitzer grep gitignore", () => {
  test("#given a git workspace #when a file is gitignored #then grep never reports a match inside it", async () => {
    const root = await flatTree(2)
    await mkdir(join(root, "ignored"), { recursive: true })
    await writeFile(join(root, "ignored", "secret.txt"), "needle\n", "utf8")
    await writeFile(join(root, ".gitignore"), "ignored/\n", "utf8")
    await gitInit(root)
    const tool = grepTool({ root })

    const result = await tool.execute("call-1", { pattern: "needle" })

    expect(matchPaths(result)).toEqual(["a.txt", "b.txt"])
    expect(jsonOf(result).truncated).toBe(false)
  })

  test("#given git failing on the workspace #when grep runs #then it falls back to the plain walk", async () => {
    const root = await flatTree(2)
    await mkdir(join(root, "ignored"), { recursive: true })
    await writeFile(join(root, "ignored", "secret.txt"), "needle\n", "utf8")
    await writeFile(join(root, ".gitignore"), "ignored/\n", "utf8")
    await gitInit(root)
    const failing: GitExec = { run: async () => ({ code: 128, stdout: "", stderr: "fatal: not a git repository" }) }
    const tool = grepTool({ root, git: failing })

    const result = await tool.execute("call-1", { pattern: "needle" })

    expect(matchPaths(result)).toEqual(["a.txt", "b.txt", "ignored/secret.txt"])
    expect(jsonOf(result).truncated).toBe(false)
  })
})
