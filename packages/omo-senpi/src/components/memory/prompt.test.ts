import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { BeforeAgentStartEventResult } from "@code-yeongyu/senpi"
import {
  GitMemoryRepo,
  buildIdentityPaths,
  consumeSoulNoticeDelta,
} from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import {
  MEMORY_NUDGE_METADATA_TOKEN,
  MEMORY_PRESSURE_METADATA_TOKEN,
  MEMORY_PROMPT_TEMPLATE,
  MEMORY_SOUL_METADATA_TOKEN,
  createMemoryPromptHandler,
} from "./prompt"
import { MEMORY_PRESSURE_SOFT_RATIO } from "./status"
import { realpathSync } from "node:fs"
import { rmEfaultTolerant } from "./teardown.test-support"

const IDENTITY = "prompt-agent"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rmEfaultTolerant(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
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

async function fixtureAtSystemTokens(tokens: number): Promise<{ repo: CountingRepo; context: MemoryIdentityContext }> {
  const header = "---\ndescription: Persona\n---\n"
  return fixture("A".repeat(tokens * 4 - Buffer.byteLength(header, "utf8") - 1))
}

function messageEntry(id: string): Record<string, unknown> {
  return { type: "message", id, message: { role: "user", content: [{ type: "text", text: `entry ${id}` }] } }
}

function customEntry(id: string): Record<string, unknown> {
  return { type: "custom", id, customType: "omo-test:entry" }
}

function compactionEntry(id: string, firstKeptEntryId: string): Record<string, unknown> {
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
function liveBranch(messageCount: number): readonly unknown[] {
  return Array.from({ length: messageCount }, (_, index) => messageEntry(`m${index + 1}`))
}

/** A branch whose latest compaction pushed exactly `compactedCount` messages out of the live context. */
function compactedBranch(compactedCount: number): readonly unknown[] {
  return [
    ...Array.from({ length: compactedCount }, (_, index) => messageEntry(`old-${index + 1}`)),
    compactionEntry("c1", "kept-1"),
    messageEntry("kept-1"),
    messageEntry("kept-2"),
  ]
}

function eventContext(sessionId: string, branch: readonly unknown[]): unknown {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
      getBranch: () => branch,
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

describe("MEMORY_PROMPT_TEMPLATE", () => {
  test("#given the compiled-block cache key #when the template id is read #then it is the v3 stable template", () => {
    expect(MEMORY_PROMPT_TEMPLATE).toBe("omo-senpi:before_agent_start:v3")
  }, 30_000)
})

describe("createMemoryPromptHandler", () => {
  test("#given an unbound or disabled session #when before_agent_start dispatches #then the handler returns undefined and never touches the repo", async () => {
    // given
    const { repo } = await fixture()
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", createMemoryPromptHandler({ resolveContext: () => undefined, createRepo: () => repo }))

    // when
    const result = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", liveBranch(2)))

    // then
    expect(result).toBeUndefined()
    expect(repo.headCalls).toBe(0)
  }, 30_000)

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
  }, 30_000)

  test("#given a bound identity whose branch compacted #when before_agent_start dispatches #then the prompt gains a stable sentinel block and the compacted-out count arrives late", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", boundHandler(repo, context))

    // when
    const result = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", compactedBranch(3)))

    // then
    expect(result?.systemPrompt).toContain("BASE PROMPT")
    expect(result?.systemPrompt).toContain(`<!-- senpi-memory:${IDENTITY}:begin -->`)
    expect(result?.systemPrompt).toContain(`<!-- senpi-memory:${IDENTITY}:end -->`)
    expect(result?.systemPrompt).toContain("first")
    expect(result?.systemPrompt).toContain(`- AGENT_ID: ${IDENTITY}`)
    expect(result?.systemPrompt).not.toContain("CONVERSATION_ID")
    expect(result?.systemPrompt).not.toContain("earlier messages")
    expect(result?.message).toMatchObject({ customType: "omo-memory:notice", display: false })
    expect(result?.message?.content).toContain(
      "- 3 earlier messages were compacted out of the live context; what still matters from them arrives on its own as <recalled-memory> blocks",
    )
    // The no-recall-tool fact is standing, not session-volatile: it belongs to the compiled reminder.
    expect(result?.message?.content).not.toContain("recall tool")
    expect(result?.systemPrompt).toContain("there is no recall tool to call")
  }, 30_000)

  test("#given a branch that never compacted and no other notice line #when before_agent_start dispatches #then no compacted-out line and no message at all are injected", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", boundHandler(repo, context))

    // when
    const result = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", liveBranch(15)))

    // then
    expect(result?.systemPrompt).toContain(`<!-- senpi-memory:${IDENTITY}:begin -->`)
    expect(result?.systemPrompt).not.toContain("compacted out")
    expect(result?.message).toBeUndefined()
  }, 30_000)

  test("#given a compaction whose firstKeptEntryId is the eighth branch entry with five messages before it #when the notice renders #then it reports five compacted-out messages", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", boundHandler(repo, context))
    const branch = [
      messageEntry("m1"),
      messageEntry("m2"),
      customEntry("x1"),
      messageEntry("m3"),
      messageEntry("m4"),
      messageEntry("m5"),
      compactionEntry("c1", "kept-1"),
      messageEntry("kept-1"),
      messageEntry("kept-2"),
    ]
    expect(branch[7]).toMatchObject({ id: "kept-1" })

    // when
    const result = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", branch))

    // then
    expect(result?.message?.content).toContain(
      "- 5 earlier messages were compacted out of the live context; what still matters from them arrives on its own as <recalled-memory> blocks",
    )
  }, 30_000)

  test("#given a compaction whose firstKeptEntryId is no longer on the branch #when the notice renders #then it counts the messages before the compaction entry", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", boundHandler(repo, context))
    const branch = [
      messageEntry("m1"),
      messageEntry("m2"),
      messageEntry("m3"),
      compactionEntry("c1", "pruned-entry"),
      messageEntry("kept-1"),
    ]

    // when
    const result = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", branch))

    // then
    expect(result?.message?.content).toContain(
      "- 3 earlier messages were compacted out of the live context; what still matters from them arrives on its own as <recalled-memory> blocks",
    )
  }, 30_000)

  test("#given the same identity and HEAD across sessions and turns #when volatile notices change #then the system block stays byte-identical and notices travel as a late message", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", createMemoryPromptHandler({
      resolveContext: () => context,
      createRepo: () => repo,
      resolveNudgeTurns: async (_repo, sessionId) => sessionId === "session-after-threshold" ? 12 : undefined,
      resolveSoulNotice: async (_repo, sessionId) => sessionId === "session-after-threshold"
        ? { sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678" }
        : undefined,
    }))

    // when
    const beforeThreshold = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-before-threshold", compactedBranch(2)))
    const afterThreshold = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-after-threshold", compactedBranch(12)))

    // then
    expect(afterThreshold?.systemPrompt).toBe(beforeThreshold?.systemPrompt)
    expect(beforeThreshold?.message).toMatchObject({
      customType: "omo-memory:notice",
      display: false,
    })
    expect(beforeThreshold?.message?.content).toContain("2 earlier messages were compacted out of the live context")
    expect(afterThreshold?.message?.content).toContain("12 earlier messages were compacted out of the live context")
    expect(afterThreshold?.message?.content).toContain(MEMORY_NUDGE_METADATA_TOKEN)
    expect(afterThreshold?.message?.content).toContain(MEMORY_SOUL_METADATA_TOKEN)
  }, 30_000)

  test("#given committed system memory below the soft threshold #when before_agent_start compiles #then the block stays byte-identical to the pre-pressure format", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", createMemoryPromptHandler({
      resolveContext: () => context,
      createRepo: () => repo,
      resolveCompileWarnTokens: () => 30_000,
    }))

    // when
    const result = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", liveBranch(0)))

    // then
    expect(result?.systemPrompt).toBe([
      "BASE PROMPT",
      "",
      `<!-- senpi-memory:${IDENTITY}:begin -->`,
      "Reminder: <projection> holds local paths of memory projections. <memory> is your persistent memory across conversations. Consult it BEFORE asking the user anything it may already answer. Save durable facts, preferences, decisions, and corrections with the memory tools THE MOMENT they emerge. Route facts about a person to their record under people/ (the primary human's card is system/human.md). Relevant stored memory arrives on its own as <recalled-memory> blocks; there is no recall tool to call.",
      "",
      "<self>",
      "<projection>$MEMORY_DIR/system/persona.md</projection>",
      "first",
      "</self>",
      "",
      "<memory_metadata>",
      `- AGENT_ID: ${IDENTITY}`,
      "</memory_metadata>",
      `<!-- senpi-memory:${IDENTITY}:end -->`,
    ].join("\n"))
    expect(result?.systemPrompt).not.toContain(MEMORY_PRESSURE_METADATA_TOKEN)
  }, 30_000)

  test("#given committed system memory exactly at floor eighty percent of the advisory #when before_agent_start compiles #then one actionable pressure line carries N M and P", async () => {
    // given
    const advisory = 30_000
    const boundary = Math.floor(MEMORY_PRESSURE_SOFT_RATIO * advisory)
    const { repo, context } = await fixtureAtSystemTokens(boundary)
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", createMemoryPromptHandler({
      resolveContext: () => context,
      createRepo: () => repo,
      resolveCompileWarnTokens: () => advisory,
    }))

    // when
    const result = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", liveBranch(0)))

    // then
    expect(boundary).toBe(24_000)
    const pressureLines = result?.systemPrompt?.split("\n").filter((line) => line.includes(MEMORY_PRESSURE_METADATA_TOKEN)) ?? []
    expect(pressureLines).toHaveLength(1)
    expect(pressureLines[0]).toContain("24000/30000")
    expect(pressureLines[0]).toContain("80%")
    expect(pressureLines[0]).toMatch(/trim|demote/)
    expect(result?.systemPrompt).toContain("A".repeat(1_000))
  }, 30_000)

  test("#given nudge state at the threshold #when before_agent_start compiles #then the late message carries the behavioral nudge token", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", createMemoryPromptHandler({
      resolveContext: () => context,
      createRepo: () => repo,
      resolveNudgeTurns: async () => 2,
    }))

    // when
    const result = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", liveBranch(2)))

    // then
    expect(result?.systemPrompt).not.toContain(MEMORY_NUDGE_METADATA_TOKEN)
    expect(result?.message?.content).toContain(MEMORY_NUDGE_METADATA_TOKEN)
    expect(result?.message?.content).toMatch(/- 2 user turns since/)
    expect(result?.message?.content).not.toContain("compacted out")
  }, 30_000)

  test("#given a reflection soul notice #when before_agent_start compiles #then the late message carries the soul token and short sha", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", createMemoryPromptHandler({
      resolveContext: () => context,
      createRepo: () => repo,
      resolveSoulNotice: async () => ({ sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678" }),
    }))

    // when
    const result = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", liveBranch(2)))

    // then
    expect(result?.systemPrompt).not.toContain(MEMORY_SOUL_METADATA_TOKEN)
    expect(result?.message?.content).toContain(MEMORY_SOUL_METADATA_TOKEN)
    expect(result?.message?.content).toMatch(/- Soul updated by reflection a1b2c3d /)
  }, 30_000)

  test("#given an out-of-band soul commit #when the prompt compiles repeatedly at the same HEAD #then the soul line appears exactly once", async () => {
    // given
    const { repo, context } = await fixture()
    const watermark = {
      noticesDir: context.identityPaths.notices,
      locksDir: context.identityPaths.locks,
    }
    expect(await consumeSoulNoticeDelta(repo, watermark)).toBeUndefined()
    await writeFile(join(repo.dir, "system/persona.md"), "---\ndescription: Persona\n---\nevolved\n")
    await repo.commitWrite(
      ["system/persona.md"],
      "chore(reflection): merge run r1\n\nOmo-Writer: reflection",
      { agentId: IDENTITY, authorName: "Prompt Agent" },
    )
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", createMemoryPromptHandler({
      resolveContext: () => context,
      createRepo: () => repo,
      resolveSoulNotice: (repoArg) => consumeSoulNoticeDelta(repoArg, watermark),
    }))

    // when
    const first = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", liveBranch(1)))
    const second = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", liveBranch(1)))
    const third = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", liveBranch(1)))

    // then
    expect(first?.message?.content).toContain(MEMORY_SOUL_METADATA_TOKEN)
    // Nothing volatile is left to say on an uncompacted branch, so no notice message is injected at all.
    expect(second?.message).toBeUndefined()
    expect(third?.message).toBeUndefined()
    expect(second?.systemPrompt).toBe(first?.systemPrompt)
    expect(third?.systemPrompt).toBe(first?.systemPrompt)
  }, 30_000)

  test("#given another extension already rewrote the system prompt #when the handler runs #then the foreign text survives and the block is appended", async () => {
    // given
    const { repo, context } = await fixture()
    const foreignPi = new FakeExtensionAPI()
    foreignPi.on("before_agent_start", () => ({ systemPrompt: "BASE PROMPT\n\nFOREIGN EXTENSION TEXT" }))
    const memoryPi = new FakeExtensionAPI()
    memoryPi.on("before_agent_start", boundHandler(repo, context))

    // when — mirror the host runner: the next handler receives the previous handler's prompt
    const [foreign] = await foreignPi.dispatch("before_agent_start", beforeAgentStart("BASE PROMPT"), eventContext("session-1", liveBranch(0)))
    const foreignPrompt = (foreign as BeforeAgentStartEventResult).systemPrompt ?? ""
    const result = await dispatchEvent(memoryPi, beforeAgentStart(foreignPrompt), eventContext("session-1", liveBranch(0)))

    // then
    expect(result?.systemPrompt).toContain("FOREIGN EXTENSION TEXT")
    expect(result?.systemPrompt).toContain("BASE PROMPT")
    expect(result?.systemPrompt).toContain(`<!-- senpi-memory:${IDENTITY}:begin -->`)
  }, 30_000)

  test("#given an unchanged HEAD #when the handler runs twice #then HEAD is re-checked each run while the block compiles once", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", boundHandler(repo, context))

    // when
    const first = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", liveBranch(1)))
    const second = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", liveBranch(1)))

    // then
    expect(second?.systemPrompt).toBe(first?.systemPrompt)
    expect(repo.headCalls).toBe(2)
    expect(repo.lsTreeCalls).toBe(1)
    expect(repo.showCalls).toBe(1)
  }, 30_000)

  test("#given a commit between runs #when the next dispatch happens #then the new content appears while the prior result keeps the old content", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", boundHandler(repo, context))
    const first = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", liveBranch(1)))
    expect(repo.headCalls).toBe(1)

    // when
    await writeFile(join(repo.dir, "system/persona.md"), "---\ndescription: Persona\n---\nsecond\n")
    await repo.commitWrite(["system/persona.md"], "update persona", { agentId: IDENTITY, authorName: "Prompt Agent" })
    const headCallsAfterCommit = repo.headCalls
    const second = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", liveBranch(1)))

    // then
    expect(first?.systemPrompt).toContain("first")
    expect(first?.systemPrompt).not.toContain("second")
    expect(second?.systemPrompt).toContain("second")
    expect(repo.headCalls - headCallsAfterCommit).toBe(1)
    expect(repo.lsTreeCalls).toBe(2)
  }, 30_000)

  test("#given a prompt already carrying our sentinel block #when the handler runs #then the block is replaced, not duplicated", async () => {
    // given
    const { repo, context } = await fixture()
    const pi = new FakeExtensionAPI()
    pi.on("before_agent_start", boundHandler(repo, context))
    const first = await dispatchEvent(pi, beforeAgentStart("BASE PROMPT"), eventContext("session-1", liveBranch(1)))

    // when — the host carries last turn's prompt forward with our block inside
    const second = await dispatchEvent(pi, beforeAgentStart(first?.systemPrompt ?? ""), eventContext("session-1", liveBranch(2)))

    // then
    expect(second?.systemPrompt?.match(new RegExp(`<!-- senpi-memory:${IDENTITY}:begin -->`, "g"))).toHaveLength(1)
    expect(second?.systemPrompt?.match(new RegExp(`<!-- senpi-memory:${IDENTITY}:end -->`, "g"))).toHaveLength(1)
    expect(second?.systemPrompt).toContain("BASE PROMPT")
  }, 30_000)
})
