import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { BeforeAgentStartEventResult } from "@code-yeongyu/senpi"
import { GitMemoryRepo, buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { createMemoryPromptHandler } from "./prompt"

const IDENTITY = "prompt-agent"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

class CountingRepo extends GitMemoryRepo {
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

async function fixture(personaBody = "first"): Promise<{ repo: CountingRepo; context: MemoryIdentityContext }> {
  const dir = await mkdtemp(join(tmpdir(), "memory-prompt-"))
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

function eventContext(sessionId: string, branchLength: number): unknown {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
      getBranch: () => Array.from({ length: branchLength }, (_, index) => ({ index })),
    },
  }
}

function beforeAgentStart(systemPrompt: string): unknown {
  return { type: "before_agent_start", prompt: "hello", systemPrompt }
}

async function dispatchEvent(
  pi: FakeExtensionAPI,
  payload: unknown,
  ctx: unknown,
): Promise<BeforeAgentStartEventResult | undefined> {
  const results = await pi.dispatch("before_agent_start", payload, ctx)
  return results[0] as BeforeAgentStartEventResult | undefined
}

function boundHandler(repo: CountingRepo, context: MemoryIdentityContext) {
  return createMemoryPromptHandler({ resolveContext: () => context, createRepo: () => repo })
}

describe("createMemoryPromptHandler", () => {
  test("#given an unbound or disabled session #when before_agent_start dispatches #then the handler returns undefined and never touches the repo", async () => {
    // given
    const { repo } = await fixture()
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", createMemoryPromptHandler({ resolveContext: () => undefined, createRepo: () => repo }))

    // when
    const result = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", 2))

    // then
    expect(result).toBeUndefined()
    expect(repo.headCalls).toBe(0)
  })

  test("#given an event context without a session manager #when before_agent_start dispatches #then the handler returns undefined", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", boundHandler(repo, context))

    // when
    const result = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), {})

    // then
    expect(result).toBeUndefined()
    expect(repo.headCalls).toBe(0)
  })

  test("#given a bound identity #when before_agent_start dispatches #then the prompt gains a sentinel block with identity, session, and branch metadata", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", boundHandler(repo, context))

    // when
    const result = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", 3))

    // then
    expect(result?.systemPrompt).toContain("BASE PROMPT")
    expect(result?.systemPrompt).toContain(`<!-- senpi-memory:${IDENTITY}:begin -->`)
    expect(result?.systemPrompt).toContain(`<!-- senpi-memory:${IDENTITY}:end -->`)
    expect(result?.systemPrompt).toContain("first")
    expect(result?.systemPrompt).toContain(`- AGENT_ID: ${IDENTITY}`)
    expect(result?.systemPrompt).toContain("- CONVERSATION_ID: session-1")
    expect(result?.systemPrompt).toContain("- 3 previous messages")
  })

  test("#given another extension already rewrote the system prompt #when the handler runs #then the foreign text survives and the block is appended", async () => {
    // given
    const { repo, context } = await fixture()
    const foreignPi = new FakeExtensionAPI()
    foreignPi.on("before_agent_start", () => ({ systemPrompt: "BASE PROMPT\n\nFOREIGN EXTENSION TEXT" }))
    const memoryPi = new FakeExtensionAPI()
    memoryPi.on("before_agent_start", boundHandler(repo, context))

    // when — mirror the host runner: the next handler receives the previous handler's prompt
    const [foreign] = await foreignPi.dispatch("before_agent_start", beforeAgentStart("BASE PROMPT"), eventContext("session-1", 0))
    const foreignPrompt = (foreign as BeforeAgentStartEventResult).systemPrompt ?? ""
    const result = await dispatchEvent(memoryPi, beforeAgentStart(foreignPrompt), eventContext("session-1", 0))

    // then
    expect(result?.systemPrompt).toContain("FOREIGN EXTENSION TEXT")
    expect(result?.systemPrompt).toContain("BASE PROMPT")
    expect(result?.systemPrompt).toContain(`<!-- senpi-memory:${IDENTITY}:begin -->`)
  })

  test("#given an unchanged HEAD #when the handler runs twice #then HEAD is re-checked each run while the block compiles once", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", boundHandler(repo, context))

    // when
    const first = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", 1))
    const second = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", 1))

    // then
    expect(second?.systemPrompt).toBe(first?.systemPrompt)
    expect(repo.headCalls).toBe(2)
    expect(repo.lsTreeCalls).toBe(1)
    expect(repo.showCalls).toBe(1)
  })

  test("#given a commit between runs #when the next dispatch happens #then the new content appears while the prior result keeps the old content", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", boundHandler(repo, context))
    const first = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", 1))
    expect(repo.headCalls).toBe(1)

    // when
    await writeFile(join(repo.dir, "system/persona.md"), "---\ndescription: Persona\n---\nsecond\n")
    await repo.commitWrite(["system/persona.md"], "update persona", { agentId: IDENTITY, authorName: "Prompt Agent" })
    const headCallsAfterCommit = repo.headCalls
    const second = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", 1))

    // then
    expect(first?.systemPrompt).toContain("first")
    expect(first?.systemPrompt).not.toContain("second")
    expect(second?.systemPrompt).toContain("second")
    expect(repo.headCalls - headCallsAfterCommit).toBe(1)
    expect(repo.lsTreeCalls).toBe(2)
  })

  test("#given a prompt already carrying our sentinel block #when the handler runs #then the block is replaced, not duplicated", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", boundHandler(repo, context))
    const first = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", 1))

    // when — the host carries last turn's prompt forward with our block inside
    const second = await dispatchEvent(pi, beforeAgentStart(first?.systemPrompt ?? ""), eventContext("session-1", 2))

    // then
    expect(second?.systemPrompt?.match(new RegExp(`<!-- senpi-memory:${IDENTITY}:begin -->`, "g"))).toHaveLength(1)
    expect(second?.systemPrompt?.match(new RegExp(`<!-- senpi-memory:${IDENTITY}:end -->`, "g"))).toHaveLength(1)
    expect(second?.systemPrompt).toContain("BASE PROMPT")
  })
})
