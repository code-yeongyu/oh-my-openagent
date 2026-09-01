import { afterEach } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { memoryUsagePaths } from "./memory-usage"

export const IDENTITY = "memory-usage-agent"
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

export async function fixture(): Promise<{
  readonly context: MemoryIdentityContext
  readonly repoDir: string
  readonly paths: ReturnType<typeof memoryUsagePaths>
}> {
  const dir = await mkdtemp(join(tmpdir(), "memory-usage-"))
  tempDirs.push(dir)
  const identityPaths = buildIdentityPaths(join(dir, "memory"), IDENTITY)
  await mkdir(identityPaths.locks, { recursive: true })
  await mkdir(identityPaths.runtime, { recursive: true })
  await mkdir(join(identityPaths.repo, "reference", "project"), { recursive: true })
  await mkdir(join(identityPaths.repo, "notes"), { recursive: true })
  await mkdir(join(identityPaths.repo, "system"), { recursive: true })
  await mkdir(join(identityPaths.repo, ".tmp"), { recursive: true })
  await writeFile(join(identityPaths.repo, "reference", "project", "foo.md"), "# Foo")
  await writeFile(join(identityPaths.repo, "notes", "facts.md"), "# Facts")
  await writeFile(join(identityPaths.repo, "system", "persona.md"), "# Persona")
  await writeFile(join(identityPaths.repo, ".tmp", "scratch.md"), "# Scratch")
  const context = createMemoryIdentityContext({
    identity: IDENTITY,
    identityPaths,
    binding: { identity: IDENTITY, repoPathHash: "hash", boundAt: 1 },
  })
  return {
    context,
    repoDir: identityPaths.repo,
    paths: memoryUsagePaths(identityPaths),
  }
}

export function toolCall(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  return { type: "tool_call", toolCallId: "call-1", toolName, input }
}

export function eventContext(sessionId: string): unknown {
  return { sessionManager: { getSessionId: () => sessionId } }
}
