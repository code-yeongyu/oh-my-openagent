import { afterEach } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { BeforeAgentStartEventResult } from "@code-yeongyu/senpi"
import { GitMemoryRepo, buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { createMemoryPromptHandler } from "./prompt"
import { rmEfaultTolerant } from "./teardown.test-support"

export const IDENTITY = "prompt-agent"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rmEfaultTolerant(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

export class CountingRepo extends GitMemoryRepo {
  headCalls = 0
  lsTreeCalls = 0
  showCalls = 0

  override async head(): Promise<string | null> {
    this.headCalls += 1
    return super.head()
  }

  override async lsTree(revision?: string, path?: string): Promise<string[]> {
    this.lsTreeCalls += 1
    return super.lsTree(revision, path)
  }

  override async show(revision: string, path: string): Promise<string> {
    this.showCalls += 1
    return super.show(revision, path)
  }

  resetCounts(): void {
    this.headCalls = 0
    this.lsTreeCalls = 0
    this.showCalls = 0
  }
}

export async function fixture(personaBody = "first"): Promise<{ repo: CountingRepo; context: MemoryIdentityContext }> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-prompt-")))
  tempDirs.push(dir)
  const repo = new CountingRepo({ dir: join(dir, "repo"), agentId: IDENTITY })
  await repo.init({
    seedFiles: [{ relativePath: "system/persona.md", content: `---\ndescription: Persona\n---\n${personaBody}\n` }],
  })
  repo.resetCounts()
  const context = createMemoryIdentityContext({
    identity: IDENTITY,
    identityPaths: buildIdentityPaths(join(dir, "memory"), IDENTITY),
    binding: createMemoryBinding({ identity: IDENTITY, repoPath: repo.dir, boundAt: 0 }),
  })
  return { repo, context }
}

export async function fixtureAtSystemTokens(tokens: number): Promise<{ repo: CountingRepo; context: MemoryIdentityContext }> {
  const header = "---\ndescription: Persona\n---\n"
  return fixture("A".repeat(tokens * 4 - Buffer.byteLength(header, "utf8") - 1))
}

export function messageEntry(id: string): Record<string, unknown> {
  return { type: "message", id, message: { role: "user", content: [{ type: "text", text: `entry ${id}` }] } }
}

export function customEntry(id: string): Record<string, unknown> {
  return { type: "custom", id, customType: "omo-test:entry" }
}

export function compactionEntry(id: string, firstKeptEntryId: string): Record<string, unknown> {
  return {
    type: "compaction",
    id,
    parentId: null,
    timestamp: "2026-09-16T00:00:00.000Z",
    summary: "summary",
    firstKeptEntryId,
    tokensBefore: 4_000,
  }
}

/** A branch that never compacted: every one of its messages is still in the live context. */
export function liveBranch(messageCount: number): readonly unknown[] {
  return Array.from({ length: messageCount }, (_, index) => messageEntry(`m${index + 1}`))
}

/** A branch whose latest compaction pushed exactly `compactedCount` messages out of the live context. */
export function compactedBranch(compactedCount: number): readonly unknown[] {
  return [
    ...Array.from({ length: compactedCount }, (_, index) => messageEntry(`old-${index + 1}`)),
    compactionEntry("c1", "kept-1"),
    messageEntry("kept-1"),
    messageEntry("kept-2"),
  ]
}

export function eventContext(sessionId: string, branch: readonly unknown[]): unknown {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
      getBranch: () => branch,
    },
  }
}

export function beforeAgentStart(systemPrompt: string): unknown {
  return { type: "before_agent_start", prompt: "hello", systemPrompt }
}

export async function dispatchEvent(
  pi: FakeExtensionAPI,
  payload: unknown,
  ctx: unknown,
): Promise<BeforeAgentStartEventResult | undefined> {
  const results = await pi.dispatch("before_agent_start", payload, ctx)
  return results[0] as BeforeAgentStartEventResult | undefined
}

export function boundHandler(repo: CountingRepo, context: MemoryIdentityContext) {
  return createMemoryPromptHandler({ resolveContext: () => context, createRepo: () => repo })
}
