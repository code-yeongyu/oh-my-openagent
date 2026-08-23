// The write-notice gate lives in config, so the MCP registration seam must actually carry it to
// the shared receipt consumer - otherwise the knob is decorative on the search surface, exactly
// the way it would have been if only the direct tool's renderResult honoured it.
import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

import { resolveMemoryIdentity } from "@oh-my-opencode/memory-core"

import { ensureIdentityRuntimeDirs } from "./context"
import { createMemoryComponent } from "./index"
import { MEMORY_WRITE_UPDATED_ENTRY_TYPE } from "./memory-notice-wiring"
import {
  MemoryFakeExtensionAPI,
  componentContext,
  loadedMemoryConfig,
  memorySettings,
} from "./memory.test-support"
import { SOUL_UPDATED_ENTRY_TYPE } from "./soul-notice"
import { writeToolReceipt } from "./tool-receipts"

const SESSION_ID = "session-mcp-notice"
const COMMIT = {
  sha: "c3d4e5f60718293a4b5c6d7e8f90123456789012",
  subject: "rewrite my persona",
  affectedPaths: ["system/persona.md"],
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

async function dispatchMcpWrite(writeNoticeEnabled: boolean, toolCallId: string): Promise<MemoryFakeExtensionAPI> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-mcp-notice-")))
  roots.push(root)
  const cwd = join(root, "project")
  const env = { OMO_MEMORY_HOME: join(root, "memory") }
  const identity = resolveMemoryIdentity("auto", cwd, env)
  await ensureIdentityRuntimeDirs(identity.paths)
  await mkdir(join(identity.paths.transcripts, SESSION_ID), { recursive: true })
  await writeToolReceipt(identity.paths.toolReceipts, { version: 1, toolCallId, ...COMMIT })

  const pi = new MemoryFakeExtensionAPI()
  createMemoryComponent({
    env,
    loadConfig: () => loadedMemoryConfig(memorySettings({
      tool_exposure: "search",
      write_notice: { enabled: writeNoticeEnabled },
    })),
    resolveCwd: () => cwd,
  }).register(pi, componentContext())

  const eventCtx = {
    sessionManager: { getSessionId: () => SESSION_ID, getEntries: () => [] },
    ui: { notify: () => {} },
  }
  await pi.dispatch("session_start", {}, eventCtx)
  await pi.dispatch("tool_result", {
    type: "tool_result",
    toolName: "mcp_omo-memory_memory",
    toolCallId,
    input: {},
    content: [],
    isError: false,
  }, eventCtx)
  return pi
}

describe("memory MCP notice wiring", () => {
  test("#given the write notice is enabled #when an MCP memory tool_result carries a soul commit receipt #then both notices are appended", async () => {
    // when
    const pi = await dispatchMcpWrite(true, "call-mcp-on")

    // then
    const appended = pi.entries.map((entry) => entry.customType)
    expect(appended).toContain(SOUL_UPDATED_ENTRY_TYPE)
    expect(appended).toContain(MEMORY_WRITE_UPDATED_ENTRY_TYPE)
  }, 30_000)

  test("#given the write notice is disabled in config #when the same tool_result fires #then only the soul notice is appended", async () => {
    // when
    const pi = await dispatchMcpWrite(false, "call-mcp-off")

    // then
    const appended = pi.entries.map((entry) => entry.customType)
    expect(appended).toContain(SOUL_UPDATED_ENTRY_TYPE)
    expect(appended).not.toContain(MEMORY_WRITE_UPDATED_ENTRY_TYPE)
  }, 30_000)
})
