import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import {
  MEMORIAN_NUDGE_EXTENSION_FILENAME,
  MEMORIAN_NUDGE_EXTENSION_SOURCE,
  MEMORIAN_NUDGE_PATH_ENV,
} from "./memorian-nudge-extension"

const tempDirs: string[] = []

async function materialize(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "memorian-nudge-ext-"))
  tempDirs.push(dir)
  const file = join(dir, MEMORIAN_NUDGE_EXTENSION_FILENAME)
  await writeFile(file, MEMORIAN_NUDGE_EXTENSION_SOURCE, { encoding: "utf8", mode: 0o600 })
  return file
}

type CapturedTool = {
  name: string
  label: string
  description: string
  parameters: unknown
  execute: (
    toolCallId: string,
    params: { path: string, hint: string },
  ) => Promise<{ content: { type: string, text: string }[] }>
}

async function loadTools(file: string): Promise<CapturedTool[]> {
  const module = await import(`${pathToFileURL(file).href}?v=${Date.now()}-${Math.random()}`) as {
    default: (pi: { registerTool: (tool: CapturedTool) => void }) => void | Promise<void>
  }
  const tools: CapturedTool[] = []
  await module.default({ registerTool: (tool) => tools.push(tool) })
  return tools
}

afterEach(async () => {
  delete process.env[MEMORIAN_NUDGE_PATH_ENV]
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })),
  )
})

describe("memorian nudge extension asset", () => {
  it("#given the materialized source #when the factory runs #then exactly one tool named nudge registers", async () => {
    // given
    const file = await materialize()

    // when
    const tools = await loadTools(file)

    // then
    expect(tools).toHaveLength(1)
    expect(tools[0]?.name).toBe("nudge")
  })

  it("#given a nudge path in the environment #when the handler runs #then one NDJSON line lands", async () => {
    // given
    const file = await materialize()
    const nudgePath = join(file, "..", "nudges.ndjson")
    process.env[MEMORIAN_NUDGE_PATH_ENV] = nudgePath
    const [tool] = await loadTools(file)

    // when
    const result = await tool!.execute("call-1", { path: "reference/a.md", hint: "alpha" })
    await tool!.execute("call-2", { path: "notes/b.md", hint: "beta" })

    // then
    const lines = (await readFile(nudgePath, "utf8")).split("\n").filter((line) => line.length > 0)
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { path: "reference/a.md", hint: "alpha" },
      { path: "notes/b.md", hint: "beta" },
    ])
    expect(result.content[0]?.type).toBe("text")
  })

  it("#given a multiline hint #when the handler runs #then the appended record stays one NDJSON line", async () => {
    // given
    const file = await materialize()
    const nudgePath = join(file, "..", "nudges.ndjson")
    process.env[MEMORIAN_NUDGE_PATH_ENV] = nudgePath
    const [tool] = await loadTools(file)

    // when
    await tool!.execute("call-1", { path: "reference/a.md", hint: "first\nsecond" })

    // then
    const raw = await readFile(nudgePath, "utf8")
    expect(raw.split("\n").filter((line) => line.length > 0)).toHaveLength(1)
    expect(JSON.parse(raw)).toEqual({ path: "reference/a.md", hint: "first\nsecond" })
  })

  it("#given no nudge path in the environment #when the handler runs #then it reports the failure instead of writing", async () => {
    // given
    const file = await materialize()
    const [tool] = await loadTools(file)

    // when / then
    await expect(tool!.execute("call-1", { path: "reference/a.md", hint: "alpha" })).rejects.toThrow()
  })
})
