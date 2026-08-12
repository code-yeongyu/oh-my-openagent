import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { realpathSync } from "node:fs"

import { GitMemoryRepo, buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext } from "./context"
import { MemoryFakeExtensionAPI, type SessionEntryFixture } from "./memory.test-support"
import {
  ACCEPTED_TURNS_ENTRY_TYPE,
  createMemoryNudgeWiring,
} from "./nudge-wiring"

const roots: string[] = []

async function fixture() {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-nudge-")))
  roots.push(root)
  const identity = "named-agent"
  const identityPaths = buildIdentityPaths(root, identity)
  const context = createMemoryIdentityContext({
    identity,
    identityPaths,
    binding: createMemoryBinding({ identity, repoPath: identityPaths.repo, boundAt: 1 }),
  })
  const repo = new GitMemoryRepo({ dir: identityPaths.repo, agentId: identity })
  await repo.init()
  return { context, repo }
}

function eventContext(sessionId: string, entries: readonly SessionEntryFixture[] = []) {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
      getEntries: () => entries,
    },
  }
}

function input(inputId: string, source: "interactive" | "rpc" | "extension" = "interactive") {
  return { type: "input", inputId, text: inputId, source }
}

function disposition(inputId: string, value: "handled" | "queued" | "started" | "rejected") {
  return { type: "input_disposition", inputId, disposition: value }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

describe("createMemoryNudgeWiring", () => {
  test("#given a fresh session #when two interactive inputs are accepted while extension and rejected inputs occur #then only the accepted interactive turns reach the threshold", async () => {
    // given
    const { context, repo } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    const wiring = createMemoryNudgeWiring({
      resolveContext: () => context,
      resolveSettings: () => ({ enabled: true, everyUserTurns: 2 }),
    })
    wiring.register(pi)
    const ctx = eventContext("session-1")
    await pi.dispatch("session_start", {}, ctx)

    // when
    await pi.dispatch("input", input("extension", "extension"), ctx)
    await pi.dispatch("input_disposition", disposition("extension", "started"), ctx)
    await pi.dispatch("input", input("rejected"), ctx)
    await pi.dispatch("input_disposition", disposition("rejected", "rejected"), ctx)
    await pi.dispatch("input", input("first"), ctx)
    await pi.dispatch("input_disposition", disposition("first", "started"), ctx)
    const beforeThreshold = await wiring.nudgeTurns(repo, "session-1", context.identity)
    await pi.dispatch("input", input("second", "rpc"), ctx)
    await pi.dispatch("input_disposition", disposition("second", "queued"), ctx)

    // then
    expect(beforeThreshold).toBeUndefined()
    expect(await wiring.nudgeTurns(repo, "session-1", context.identity)).toBe(2)
    expect(pi.handlers.map((handler) => handler.event)).not.toContain("agent_settled")
    expect(pi.entries.at(-1)).toEqual({
      customType: ACCEPTED_TURNS_ENTRY_TYPE,
      data: { version: 1, sessionId: "session-1", priorUserTurns: 2, sessionBaselineTurns: 0 },
    })
  }, 30_000)

  test("#given a durable accepted-turn record and contaminated branch users #when a session resumes #then hydration uses only the durable baseline", async () => {
    // given
    const { context, repo } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    const wiring = createMemoryNudgeWiring({
      resolveContext: () => context,
      resolveSettings: () => ({ enabled: true, everyUserTurns: 2 }),
    })
    wiring.register(pi)
    const entries: SessionEntryFixture[] = [
      { type: "message", data: { role: "user", source: "extension" } },
      {
        type: "custom",
        customType: ACCEPTED_TURNS_ENTRY_TYPE,
        data: { version: 1, sessionId: "resumed", priorUserTurns: 8, sessionBaselineTurns: 6 },
      },
      { type: "message", data: { role: "user", source: "extension" } },
    ]

    // when
    await pi.dispatch("session_start", {}, eventContext("resumed", entries))

    // then
    expect(await wiring.nudgeTurns(repo, "resumed", context.identity)).toBe(2)
    expect(wiring.provenance("resumed")).toEqual({ sessionId: "resumed", userTurns: 8 })
  }, 30_000)

  test("#given one durable accepted turn and a second admitted input awaiting its started disposition #when the prompt compiles #then the projected accepted turn reaches the threshold", async () => {
    // given
    const { context, repo } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    const wiring = createMemoryNudgeWiring({
      resolveContext: () => context,
      resolveSettings: () => ({ enabled: true, everyUserTurns: 2 }),
    })
    wiring.register(pi)
    const ctx = eventContext("session-order", [{
      type: "custom",
      customType: ACCEPTED_TURNS_ENTRY_TYPE,
      data: { version: 1, sessionId: "session-order", priorUserTurns: 1, sessionBaselineTurns: 0 },
    }])
    await pi.dispatch("session_start", {}, ctx)
    await pi.dispatch("input", input("second-before-started"), ctx)

    // when
    const turns = await wiring.nudgeTurns(repo, "session-order", context.identity)

    // then
    expect(turns).toBe(2)
  }, 30_000)

  test("#given a threshold on an identity with no repository yet #when nudge state resolves #then the fresh-session baseline is used without requiring git history", async () => {
    // given
    const { context } = await fixture()
    await rm(context.identityPaths.repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    const repo = new GitMemoryRepo({ dir: context.identityPaths.repo, agentId: context.identity })
    const pi = new MemoryFakeExtensionAPI()
    const wiring = createMemoryNudgeWiring({
      resolveContext: () => context,
      resolveSettings: () => ({ enabled: true, everyUserTurns: 2 }),
    })
    wiring.register(pi)
    await pi.dispatch("session_start", {}, eventContext("session-no-repo", [{
      type: "custom",
      customType: ACCEPTED_TURNS_ENTRY_TYPE,
      data: { version: 1, sessionId: "session-no-repo", priorUserTurns: 2, sessionBaselineTurns: 0 },
    }]))

    // when
    const turns = wiring.nudgeTurns(repo, "session-no-repo", context.identity)

    // then
    expect(await turns).toBe(2)
  }, 30_000)

  test("#given a threshold nudge #when an in-band memory commit lands #then the next compile state self-clears and disabled settings remain quiet", async () => {
    // given
    const { context, repo } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    let enabled = true
    const wiring = createMemoryNudgeWiring({
      resolveContext: () => context,
      resolveSettings: () => ({ enabled, everyUserTurns: 2 }),
    })
    wiring.register(pi)
    const ctx = eventContext("session-clear", [{
      type: "custom",
      customType: ACCEPTED_TURNS_ENTRY_TYPE,
      data: { version: 1, sessionId: "session-clear", priorUserTurns: 2, sessionBaselineTurns: 0 },
    }])
    await pi.dispatch("session_start", {}, ctx)
    expect(await wiring.nudgeTurns(repo, "session-clear", context.identity)).toBe(2)

    // when
    await writeFile(join(repo.dir, "saved.md"), "saved\n")
    await repo.commitWrite(
      ["saved.md"],
      "save memory\n\nOmo-Writer: memory-tool\nOmo-Session: session-clear\nOmo-Turn: 2",
      { agentId: context.identity, authorName: context.identity },
    )
    const cleared = await wiring.nudgeTurns(repo, "session-clear", context.identity)
    enabled = false

    // then
    expect(cleared).toBeUndefined()
    expect(await wiring.nudgeTurns(repo, "session-clear", context.identity)).toBeUndefined()
  }, 30_000)

  test("#given a bound non-auto identity #when a memory MCP tool call starts #then unforgeable identity and accepted-turn provenance are injected in place", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    const wiring = createMemoryNudgeWiring({
      resolveContext: () => context,
      resolveSettings: () => ({ enabled: true, everyUserTurns: 2 }),
    })
    wiring.register(pi)
    const ctx = eventContext("session-tool", [{
      type: "custom",
      customType: ACCEPTED_TURNS_ENTRY_TYPE,
      data: { version: 1, sessionId: "session-tool", priorUserTurns: 5, sessionBaselineTurns: 1 },
    }])
    await pi.dispatch("session_start", {}, ctx)
    const call: {
      type: string
      toolCallId: string
      toolName: string
      input: Record<string, unknown>
    } = { type: "tool_call", toolCallId: "call-1", toolName: "memory", input: { reason: "save" } }

    // when
    await pi.dispatch("tool_call", call, ctx)

    // then
    expect(call.input).toEqual({
      reason: "save",
      provenance: {
        sessionId: "session-tool",
        userTurns: 5,
        identityId: context.identity,
        repoPath: context.identityPaths.repo,
        toolCallId: "call-1",
      },
    })
  }, 30_000)

  test("#given a bound identity #when an MCP-surface memory tool call starts #then provenance is injected under the catalog tool names", async () => {
    // given
    const { context } = await fixture()
    const pi = new MemoryFakeExtensionAPI()
    const wiring = createMemoryNudgeWiring({
      resolveContext: () => context,
      resolveSettings: () => ({ enabled: true, everyUserTurns: 2 }),
    })
    wiring.register(pi)
    const ctx = eventContext("session-mcp-call", [{
      type: "custom",
      customType: ACCEPTED_TURNS_ENTRY_TYPE,
      data: { version: 1, sessionId: "session-mcp-call", priorUserTurns: 4, sessionBaselineTurns: 1 },
    }])
    await pi.dispatch("session_start", {}, ctx)
    const call: {
      type: string
      toolCallId: string
      toolName: string
      input: Record<string, unknown>
    } = { type: "tool_call", toolCallId: "call-mcp-1", toolName: "mcp_omo-memory_memory_apply_patch", input: { reason: "save" } }

    // when
    await pi.dispatch("tool_call", call, ctx)

    // then
    expect(call.input["provenance"]).toEqual({
      sessionId: "session-mcp-call",
      userTurns: 4,
      identityId: context.identity,
      repoPath: context.identityPaths.repo,
      toolCallId: "call-mcp-1",
    })
  }, 30_000)
})
