import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSyncEfaultTolerant } from "../components/memory/teardown.test-support"

import { GitMemoryRepo, buildIdentityPaths, parseMemoryFile } from "@oh-my-opencode/memory-core"

import { createMemoryBinding } from "../components/memory/binding"
import { createMemoryIdentityContext } from "../components/memory/context"
import { MemoryFakeExtensionAPI } from "../components/memory/memory.test-support"
import { ACCEPTED_TURNS_ENTRY_TYPE, createMemoryNudgeWiring } from "../components/memory/nudge-wiring"
import { handleMemoryMcpRequest } from "./memory-server"

const roots: string[] = []

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "omo-memory-mcp-"))
  roots.push(root)
  return {
    cwd: join(root, "project"),
    env: { ...process.env, OMO_MEMORY_HOME: join(root, "memory-home") },
  }
}

afterEach(() => {
  // Windows keeps git's handles open briefly after the child exits, so a bare recursive remove
  // throws EBUSY and fails the test that already passed. Retry the unlink instead.
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

// Each case drives real git subprocesses through a fresh repository; the 5s default is not a
// budget these operations fit on a loaded Windows runner.
setDefaultTimeout(process.platform === "win32" ? 30_000 : 5_000)

describe("omo-memory MCP server", () => {
  test("#given initialize #then server info and tool capabilities are returned", async () => {
    const result = await handleMemoryMcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    const payload = result?.result as { serverInfo?: { name?: string }; capabilities?: { tools?: unknown } } | undefined
    expect(payload?.serverInfo?.name).toBe("omo-memory")
    expect(payload?.capabilities?.tools).toBeDefined()
  })

  test("#given tools/list #then exactly the two memory tools are exposed", async () => {
    const result = await handleMemoryMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    const tools = (result?.result as { tools?: { name: string }[] } | undefined)?.tools ?? []
    expect(tools.map((tool) => tool.name)).toEqual(["memory", "memory_apply_patch"])
  })

  test("#given a fresh project #when create then str_replace run through tools/call #then the memory repo records them", async () => {
    const { cwd, env } = fixture()
    const created = await handleMemoryMcpRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "memory", arguments: {
        command: "create", reason: "Record preference", file_path: "system/human/preferences.md",
        description: "User preferences", file_text: "theme: dark",
      } } },
      { cwd, env },
    )
    expect((created?.result as { isError?: boolean } | undefined)?.isError).toBeFalsy()

    const replaced = await handleMemoryMcpRequest(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "memory", arguments: {
        command: "str_replace", reason: "Switch theme", file_path: "system/human/preferences.md",
        old_string: "theme: dark", new_string: "theme: light",
      } } },
      { cwd, env },
    )
    expect((replaced?.result as { isError?: boolean } | undefined)?.isError).toBeFalsy()

    const agentsDir = join(String(env.OMO_MEMORY_HOME), "agents")
    const identityDir = readdirSync(agentsDir)[0]
    expect(identityDir).toBeDefined()
    const repoDir = join(agentsDir, String(identityDir), "repo")
    const profile = parseMemoryFile(readFileSync(join(repoDir, "system/human/preferences.md"), "utf8"))
    const repo = new GitMemoryRepo({ dir: repoDir, agentId: String(identityDir) })
    expect(profile.frontmatter.description).toBe("User preferences")
    expect(profile.body.trim()).toBe("theme: light")
    expect((await repo.log({ limit: 2 })).map((entry) => entry.subject)).toEqual(["Switch theme", "Record preference"])
  })

  test("#given injected provenance for a non-auto identity #when an MCP memory call runs #then it writes that bound repo with durable turn trailers", async () => {
    // given
    const { cwd, env } = fixture()
    const identityId = "explicit-agent-deadbeef"
    const paths = buildIdentityPaths(String(env.OMO_MEMORY_HOME), identityId)
    const repo = new GitMemoryRepo({ dir: paths.repo, agentId: identityId })
    await repo.init({ installHooks: () => undefined })
    const context = createMemoryIdentityContext({
      identity: identityId,
      identityPaths: paths,
      binding: createMemoryBinding({ identity: identityId, repoPath: paths.repo, boundAt: 1 }),
    })
    const pi = new MemoryFakeExtensionAPI()
    const nudge = createMemoryNudgeWiring({
      resolveContext: () => context,
      resolveSettings: () => ({ enabled: true, everyUserTurns: 2 }),
    })
    nudge.register(pi)
    const eventContext = {
      sessionManager: {
        getSessionId: () => "session-mcp",
        getEntries: () => [{
          type: "custom",
          customType: ACCEPTED_TURNS_ENTRY_TYPE,
          data: { version: 1, sessionId: "session-mcp", priorUserTurns: 3, sessionBaselineTurns: 1 },
        }],
      },
    }
    await pi.dispatch("session_start", {}, eventContext)
    expect(await nudge.nudgeTurns(repo, "session-mcp", identityId)).toBe(2)

    // when
    const result = await handleMemoryMcpRequest(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "memory", arguments: {
        command: "create",
        reason: "Record bound identity",
        file_path: "bound.md",
        description: "Bound",
        provenance: {
          sessionId: "session-mcp",
          userTurns: 3,
          identityId,
          repoPath: paths.repo,
        },
      } } },
      { cwd, env },
    )

    // then
    expect((result?.result as { isError?: boolean } | undefined)?.isError).toBeFalsy()
    const committed = parseMemoryFile(await repo.show("HEAD", "bound.md"))
    expect(committed.frontmatter.description).toBe("Bound")
    expect(committed.body.trim()).toBe("")
    expect((await repo.log({ limit: 1 }))[0]?.trailers).toEqual({
      "Omo-Writer": "memory-tool",
      "Omo-Session": "session-mcp",
      "Omo-Turn": "3",
    })
    expect(await nudge.nudgeTurns(repo, "session-mcp", identityId)).toBeUndefined()
    expect(readdirSync(join(String(env.OMO_MEMORY_HOME), "agents"))).toEqual([identityId])
  })

  test("#given injected provenance with a toolCallId #when an MCP memory call commits #then an out-of-band receipt lands under runtime/tool-receipts", async () => {
    // given
    const { cwd, env } = fixture()
    const identityId = "receipt-agent-deadbeef"
    const paths = buildIdentityPaths(String(env.OMO_MEMORY_HOME), identityId)
    const repo = new GitMemoryRepo({ dir: paths.repo, agentId: identityId })
    await repo.init({ installHooks: () => undefined })

    // when
    const result = await handleMemoryMcpRequest(
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "memory", arguments: {
        command: "create",
        reason: "rewrite persona",
        file_path: "system/persona.md",
        description: "Persona",
        file_text: "v2 soul",
        provenance: {
          sessionId: "session-mcp",
          userTurns: 3,
          identityId,
          repoPath: paths.repo,
          toolCallId: "call-receipt-1",
        },
      } } },
      { cwd, env },
    )

    // then
    expect((result?.result as { isError?: boolean } | undefined)?.isError).toBeFalsy()
    const key = createHash("sha256").update("call-receipt-1").digest("hex").slice(0, 32)
    const receipt = JSON.parse(readFileSync(join(paths.toolReceipts, `${key}.json`), "utf8")) as Record<string, unknown>
    expect(receipt["version"]).toBe(1)
    expect(receipt["toolCallId"]).toBe("call-receipt-1")
    expect(receipt["sha"]).toBe(await repo.head())
    expect(receipt["subject"]).toBe("rewrite persona")
    expect(receipt["affectedPaths"]).toEqual(["system/persona.md"])
  })

  test("#given no injected toolCallId #when an MCP memory call commits #then no receipt is written", async () => {
    // given
    const { cwd, env } = fixture()

    // when
    const created = await handleMemoryMcpRequest(
      { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "memory", arguments: {
        command: "create", reason: "standalone write", file_path: "notes.md",
        description: "Note", file_text: "standalone",
      } } },
      { cwd, env },
    )

    // then
    expect((created?.result as { isError?: boolean } | undefined)?.isError).toBeFalsy()
    const agentsDir = join(String(env.OMO_MEMORY_HOME), "agents")
    const [identityDir] = readdirSync(agentsDir)
    const repoDir = join(agentsDir, String(identityDir), "repo")
    const repo = new GitMemoryRepo({ dir: repoDir, agentId: String(identityDir) })
    expect((await repo.log({ limit: 1 }))[0]?.subject).toBe("standalone write")
    expect(parseMemoryFile(await repo.show("HEAD", "notes.md")).body.trim()).toBe("standalone")
    const receiptsDir = join(agentsDir, String(identityDir), "runtime", "tool-receipts")
    expect(existsSync(receiptsDir) ? readdirSync(receiptsDir) : []).toEqual([])
  })

  test("#given a failing MCP memory call with a toolCallId #when the call errors #then no receipt is written", async () => {
    // given
    const { cwd, env } = fixture()
    const identityId = "receipt-failure-agent"
    const paths = buildIdentityPaths(String(env.OMO_MEMORY_HOME), identityId)
    const repo = new GitMemoryRepo({ dir: paths.repo, agentId: identityId })
    await repo.init({ installHooks: () => undefined })

    // when
    const result = await handleMemoryMcpRequest(
      { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "memory", arguments: {
        command: "str_replace",
        reason: "edit a missing file",
        file_path: "system/persona.md",
        old_string: "nothing",
        new_string: "something",
        provenance: {
          sessionId: "session-mcp",
          userTurns: 3,
          identityId,
          repoPath: paths.repo,
          toolCallId: "call-failed-1",
        },
      } } },
      { cwd, env },
    )

    // then
    expect((result?.result as { isError?: boolean } | undefined)?.isError).toBe(true)
    const key = createHash("sha256").update("call-failed-1").digest("hex").slice(0, 32)
    expect(existsSync(join(paths.toolReceipts, `${key}.json`))).toBe(false)
  })

  test("#given an unknown tool name #when called #then an error result is returned", async () => {
    const { cwd, env } = fixture()
    const result = await handleMemoryMcpRequest(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope", arguments: {} } },
      { cwd, env },
    )
    expect((result?.result as { isError?: boolean } | undefined)?.isError).toBe(true)
  })
})
