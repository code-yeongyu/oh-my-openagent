import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

import { ensureIdentityRuntimeDirs } from "./context"
import type { MemoryIdentityContext } from "./context"
import type { MemoryIdentityRuntime } from "./identity-runtime"
import { createMemoryComponent } from "./index"
import { componentContext, loadedMemoryConfig, memorySettings, MemoryFakeExtensionAPI } from "./memory.test-support"
import { TRANSIENT_DIRNAME } from "./transient-identity"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

function fixture(): { readonly cwd: string; readonly memoryHome: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-memory-transient-run-"))
  roots.push(root)
  return { cwd: join(root, "project"), memoryHome: join(root, "memory") }
}

function sessionEventContext(hasUI: boolean): unknown {
  return {
    hasUI,
    sessionManager: {
      getBranch: () => [],
      getEntries: () => [],
      getSessionId: () => "session-transient",
    },
    ui: { notify: () => {} },
  }
}

function fakeRuntime(): MemoryIdentityRuntime {
  return {
    launch: () => {},
    reconcile: async () => {},
  } as unknown as MemoryIdentityRuntime
}

async function bind(options: {
  readonly hasUI: boolean
}): Promise<{
  readonly pi: MemoryFakeExtensionAPI
  readonly context: MemoryIdentityContext
  readonly memoryHome: string
  shutdown(): Promise<void>
}> {
  const { cwd, memoryHome } = fixture()
  const pi = new MemoryFakeExtensionAPI()
  let captured: MemoryIdentityContext | undefined
  createMemoryComponent({
    env: { OMO_MEMORY_HOME: memoryHome },
    loadConfig: () => loadedMemoryConfig(memorySettings()),
    resolveCwd: () => cwd,
    createRuntime: (context) => {
      captured = context
      return fakeRuntime()
    },
  }).register(pi, componentContext())

  const eventCtx = sessionEventContext(options.hasUI)
  await pi.dispatch("session_start", { type: "session_start" }, eventCtx)
  if (captured === undefined) throw new Error("session_start did not bind a memory identity")
  return {
    pi,
    context: captured,
    memoryHome,
    shutdown: async () => {
      await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, eventCtx)
    },
  }
}

describe("transient one-shot memory runs", () => {
  test("#given a headless one-shot run #when it writes runtime state #then nothing lands under the agents root and the run root is reclaimed at shutdown", async () => {
    const bound = await bind({ hasUI: false })

    await ensureIdentityRuntimeDirs(bound.context.identityPaths)

    const transientArea = join(bound.memoryHome, TRANSIENT_DIRNAME)
    expect(bound.context.identityPaths.root.startsWith(transientArea)).toBe(true)
    expect(existsSync(bound.context.identityPaths.transcripts)).toBe(true)
    expect(existsSync(join(bound.memoryHome, "agents"))).toBe(false)

    await bound.shutdown()

    expect(readdirSync(transientArea)).toEqual([])
    expect(existsSync(join(bound.memoryHome, "agents"))).toBe(false)
  })

  test("#given an interactive run #when it writes runtime state #then the durable identity directory is used and kept", async () => {
    const bound = await bind({ hasUI: true })

    await ensureIdentityRuntimeDirs(bound.context.identityPaths)

    expect(bound.context.identityPaths.root.startsWith(join(bound.memoryHome, "agents"))).toBe(true)
    await bound.shutdown()
    expect(existsSync(bound.context.identityPaths.transcripts)).toBe(true)
    expect(existsSync(join(bound.memoryHome, TRANSIENT_DIRNAME))).toBe(false)
  })

  test("#given an enabled memory component #when it registers #then the transient sweep runs for the resolved memory root without any user action", async () => {
    const { cwd, memoryHome } = fixture()
    const pi = new MemoryFakeExtensionAPI()
    const swept: string[] = []
    const started = new Promise<void>((resolve) => {
      createMemoryComponent({
        env: { OMO_MEMORY_HOME: memoryHome },
        loadConfig: () => loadedMemoryConfig(memorySettings()),
        resolveCwd: () => cwd,
        sweepTransientRuns: (input) => {
          swept.push(input.memoryRoot)
          resolve()
          return Promise.resolve({ removedRuns: 0, removedIdentities: 0, promoted: 0, stranded: 0, kept: 0 })
        },
      }).register(pi, componentContext())
    })

    await started

    expect(swept).toEqual([memoryHome])
  })
})
