import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from "../senpi-test-runtime"
import { composeOmoSenpiExtension } from "./compose"
import { REMOTE_WAKE_SEAM, REMOTE_WAKE_UNAVAILABLE } from "./senpi-seams"
import { loadWithPinnedSenpi, withSeamEdit, type SeamEdit } from "./senpi-seams.test-support"
import type { ComponentLogger } from "./types"

function recordingLogger(): { readonly logger: ComponentLogger; readonly warnings: string[] } {
  const warnings: string[] = []
  return { warnings, logger: { info() {}, error() {}, warn: (message, details) => { warnings.push(details === undefined ? message : `${message} ${JSON.stringify(details)}`) } } }
}

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

async function loadComposed(edit: SeamEdit, logger: ComponentLogger): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-seams-"))
  roots.push(root)
  const extension = composeOmoSenpiExtension([], { logger, scheduleStartupWork: () => () => undefined })
  await loadWithPinnedSenpi(root, (pi) => extension(withSeamEdit(pi, edit)))
}

describe("absent-seam startup line", () => {
  test("#given the pinned senpi with every listed seam #when omo starts #then it writes no seam line", async () => {
    // given
    const { logger, warnings } = recordingLogger()

    // when
    await loadComposed({}, logger)

    // then
    expect(warnings).toEqual([])
  })

  test("#given the pinned senpi missing two seams #when omo starts #then it writes exactly one line naming both", async () => {
    // given
    const { logger, warnings } = recordingLogger()

    // when
    await loadComposed({ hide: ["registerReadClassifier", "rpc.handle"] }, logger)

    // then
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain("\n")
    expect(warnings[0]).toMatch(/: registerReadClassifier, rpc\.handle$/)
  })
})

describe("monitor open on a remote session target", () => {
  async function preflightMonitor(edit: SeamEdit, target: string): Promise<{ readonly block?: boolean; readonly reason?: string } | undefined> {
    const root = mkdtempSync(join(tmpdir(), "omo-senpi-remote-wake-"))
    roots.push(root)
    const agentDir = join(root, "agent")
    mkdirSync(agentDir)
    const settingsManager = SettingsManager.inMemory({ defaultProjectTrust: "always", enabledBuiltinExtensions: ["terminal"] })
    const registry = new ModelRegistry(ModelRuntime.createSync({ modelsPath: null }))
    const extension = composeOmoSenpiExtension([], { logger: recordingLogger().logger, scheduleStartupWork: () => () => undefined })
    const loader = new DefaultResourceLoader({
      cwd: root, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [(pi) => extension(withSeamEdit(pi, edit))],
    })
    await loader.reload()
    expect(loader.getExtensions().errors).toEqual([])
    const { session } = await createAgentSession({
      cwd: root, agentDir, settingsManager, modelRegistry: registry, resourceLoader: loader,
      sessionManager: SessionManager.inMemory(root), autoTitleSessions: false,
    })
    try {
      await session.bindExtensions({ mode: "print" })
      const args = { type: "rpc", target, description: "peer session", events: "all" }
      return await session.preflightToolCall({ type: "toolCall", id: "monitor-1", name: "monitor", arguments: args }, args)
    } finally {
      session.dispose()
    }
  }

  test("#given senpi without the remote-wake seam #when a monitor opens on <device>/<session> #then the call is refused with remote_wake_unavailable", async () => {
    // given
    const edit = { hide: [REMOTE_WAKE_SEAM] }

    // when
    const result = await preflightMonitor(edit, "relay-peer/s-0123")

    // then
    expect(result?.block).toBe(true)
    expect(result?.reason?.startsWith(`${REMOTE_WAKE_UNAVAILABLE}: `)).toBe(true)
  })

  test("#given senpi without the remote-wake seam #when a monitor opens on a local target #then the call goes ahead", async () => {
    // given
    const edit = { hide: [REMOTE_WAKE_SEAM] }

    // when
    const targets = ["all", "children", "st_0123", "sessions/run.jsonl", "sessions/run.JSONL", "C:/x", "/abs/session", "./x", "../x", "~/x", ".omo/x", "s-0123"]
    const results = await Promise.all(targets.map((target) => preflightMonitor(edit, target)))

    // then
    expect(targets.filter((_, index) => results[index]?.block === true)).toEqual([])
  })

  test("#given senpi with the remote-wake seam #when a monitor opens on <device>/<session> #then omo leaves the call to senpi", async () => {
    // given
    const edit = { add: { [REMOTE_WAKE_SEAM]: () => () => undefined } }

    // when
    const result = await preflightMonitor(edit, "relay-peer/s-0123")

    // then
    expect(result?.block === true).toBe(false)
  })
})
