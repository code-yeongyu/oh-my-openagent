import { afterEach } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitMemoryRepo } from "../git"

const tempDirs: string[] = []
interface CompiledBlockStructure {
  readonly sections: readonly string[]
  readonly projectionPaths: readonly string[]
  readonly memoryOpenTags: readonly string[]
  readonly metadata: {
    readonly agentId: string
  }
}

export function parseCompiledBlock(block: string): CompiledBlockStructure {
  const sections = [...block.matchAll(/^<(self|memory|memory_metadata)>$/gm)].map((match) => match[1] ?? "")
  for (const section of sections) {
    const openings = [...block.matchAll(new RegExp(`^<${section}>$`, "gm"))]
    const closings = [...block.matchAll(new RegExp(`^</${section}>$`, "gm"))]
    const start = openings[0]?.index ?? -1
    const end = closings[0]?.index ?? -1
    if (openings.length !== 1 || closings.length !== 1 || end <= start) {
      throw new Error(`invalid compiled section: ${section}`)
    }
  }

  const projectionPaths = [...block.matchAll(/<projection>\$MEMORY_DIR\/([^<]+)<\/projection>/g)]
    .map((match) => match[1] ?? "")
  const memory = region(block, "memory")
  const memoryOpenTags = memory === undefined
    ? []
    : [...memory.matchAll(/^\s*<([a-z][a-z0-9_-]*)>$/gm)].map((match) => match[1] ?? "")
  const metadata = requiredRegion(block, "memory_metadata")
  const agentId = requiredMatch(metadata, /^- AGENT_ID: (.+)$/m)

  return {
    sections,
    projectionPaths,
    memoryOpenTags,
    metadata: { agentId },
  }
}

function region(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`))
  return match?.[1]
}

function requiredRegion(block: string, tag: string): string {
  const value = region(block, tag)
  if (value === undefined) throw new Error(`missing compiled section: ${tag}`)
  return value
}

function requiredMatch(input: string, pattern: RegExp): string {
  const value = input.match(pattern)?.[1]
  if (value === undefined) throw new Error(`missing compiled field: ${pattern.source}`)
  return value
}

export async function repoWith(files: Array<{ relativePath: string; content: string }>) {
  const dir = await mkdtemp(join(tmpdir(), "memory-compile-"))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: "fixture-agent" })
  await repo.init({ seedFiles: files })
  return { dir, repo }
}

export function memory(description: string, body: string): string {
  return `---\ndescription: ${description}\n---\n${body}`
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
