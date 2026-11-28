import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { openMemoryBatchStore } from "@code-yeongyu/senpi-agent-core"
import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "../../senpi-test-runtime"
import { createMemoryIdentityContext } from "./context"
import { registerMemoryGuard } from "./guard"
import { componentContext } from "./memory.test-support"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

// #12466, review of #15248: on the PINNED senpi's Cursor exec path, the guard's replacement of a walk that met an
// identity created mid-walk must be what the exec frame answers. Synthetic identity only ("late-id").
const senpiDist = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const { createSessionCursorExecBridge } = (await import(
  pathToFileURL(join(senpiDist, "core", "cursor-exec-bridge-session.js")).href
)) as {
  createSessionCursorExecBridge: (
    sessionRef: { current?: unknown },
    getAgent: () => unknown,
    runSignal: AbortSignal,
  ) => { grep?: (args: unknown) => Promise<unknown> }
}

const FOREIGN = "synthetic-foreign-line"
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0))
    rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

async function cursorGrepFrame(options: { readonly lateIdentityDuringWalk: boolean }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-guard-cursor-pinned-")))
  roots.push(root)
  const memoryRoot = join(root, "memory")
  const cwd = join(root, "project")
  const agentDir = join(root, "agent")
  mkdirSync(cwd, { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  const ownPaths = buildIdentityPaths(memoryRoot, "global")
  mkdirSync(join(ownPaths.repo, "system"), { recursive: true })
  writeFileSync(join(ownPaths.repo, "system", "persona.md"), "synthetic own line\n")
  const own = createMemoryIdentityContext({
    identity: "global",
    identityPaths: ownPaths,
    binding: { identity: "global", repoPathHash: "hash", boundAt: 1 },
  })
  const settingsManager = SettingsManager.inMemory({ defaultProjectTrust: "always" })
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      (pi) => registerMemoryGuard(pi as never, componentContext(), { getContext: () => own, resolveCwd: () => cwd }),
    ],
  })
  await loader.reload()
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    settingsManager,
    modelRegistry: new ModelRegistry(ModelRuntime.createSync({ modelsPath: null })),
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    autoTitleSessions: false,
  })
  await session.bindExtensions({})
  const realGrep = session.getRegisteredTool("grep")
  if (realGrep === undefined) throw new Error("no grep tool")
  const grep = {
    ...realGrep,
    execute: (...args: Parameters<typeof realGrep.execute>) => {
      // The identity appears after the tool_call check cleared the call, while the walk runs.
      if (options.lateIdentityDuringWalk) {
        const late = buildIdentityPaths(memoryRoot, "late-id")
        mkdirSync(join(late.repo, "system"), { recursive: true })
        writeFileSync(join(late.repo, "system", "persona.md"), `${FOREIGN}\n`)
      }
      return realGrep.execute(...args)
    },
  }
  const bridgeSession = {
    getRegisteredTool: (name: string) => (name === "grep" ? grep : session.getRegisteredTool(name)),
    preflightToolCall: (...args: Parameters<typeof session.preflightToolCall>) => session.preflightToolCall(...args),
    releaseExecBridgeToolCall: (id: string) => session.releaseExecBridgeToolCall(id),
    emitExecBridgeToolResult: (...args: Parameters<typeof session.emitExecBridgeToolResult>) =>
      session.emitExecBridgeToolResult(...args),
  }
  const run = new AbortController()
  const agent = {
    signal: run.signal,
    batchStoreFactory: openMemoryBatchStore,
    executionScope: { id: "omo-guard-cursor", root: "" },
    async emitExternalEvent() {},
  }
  const bridge = createSessionCursorExecBridge({ current: bridgeSession }, () => agent, run.signal)
  try {
    return await bridge.grep?.({ toolCallId: "cursor-frame", pattern: "synthetic", path: memoryRoot })
  } finally {
    session.dispose()
  }
}

describe("memory guard on the pinned senpi's Cursor exec path (#12466)", () => {
  test("#given an allowed ancestor grep run through the Cursor exec bridge #when an identity is created during the walk #then the frame answers the deny and carries no foreign text", async () => {
    const frame = await cursorGrepFrame({ lateIdentityDuringWalk: true })

    expect(frame).toMatchObject({ role: "toolResult", isError: true })
    expect(JSON.stringify(frame)).toContain("cross-identity memory access denied")
    expect(JSON.stringify(frame)).not.toContain(FOREIGN)
  })

  test("#given the same grep #when no other identity appears #then the walk's own result passes through", async () => {
    const frame = await cursorGrepFrame({ lateIdentityDuringWalk: false })

    expect(frame).toMatchObject({ role: "toolResult", isError: false })
    expect(JSON.stringify(frame)).toContain("synthetic own line")
  })
})
