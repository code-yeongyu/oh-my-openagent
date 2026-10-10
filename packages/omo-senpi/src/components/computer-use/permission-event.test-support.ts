import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { resolveComputerSettings } from "@oh-my-opencode/senpi-desktop-tool"
import { DesktopEngineUnavailableError } from "@oh-my-opencode/senpi-desktop-service"
import { composeOmoSenpiExtension } from "../../extension/compose"
import type { OmoSenpiComponent } from "../../extension/types"
import { createComputerUseComponent } from "./index"

export const capture = { action: "call", chain: [{ method: "screenshot" }] }
export const input = { action: "call", chain: [{ method: "type", args: ["hello"] }] }

export async function permissionSession(options: {
  readonly error?: string
  readonly permission?: string
  readonly engineFailure?: "native-unavailable" | "quarantined"
  readonly platform?: string
  readonly sessionContext?: Readonly<Record<string, string>>
  readonly components?: readonly OmoSenpiComponent[]
} = {}) {
  const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = await import("@code-yeongyu/senpi")
  const home = await mkdtemp(join(tmpdir(), "computer-permission-"))
  const events: Array<{ name: string; data: unknown }> = []
  const extensionErrors: unknown[] = []
  const methods: string[] = []
  const settingsManager = SettingsManager.inMemory({})
  const component = createComputerUseComponent({
    platform: options.platform ?? "darwin",
    env: {},
    loadSettings: () => resolveComputerSettings({ cuaAdapter: true, auditLog: { enabled: false } }, "darwin"),
    engineChild: () => () => {
      if (options.engineFailure !== undefined) throw new DesktopEngineUnavailableError({
        code: options.engineFailure, host: "darwin-arm64", attemptedPaths: [],
        message: "Test engine is unavailable", cause: "none",
      })
      const child = spawn(process.execPath, [join(import.meta.dir, "permission-engine.test-fixture.mjs")], {
        env: { PATH: process.env.PATH, HOME: home, PERMISSION_TEST_ERROR: options.error, PERMISSION_TEST_PERMISSION: options.permission },
        stdio: "pipe",
        windowsHide: true,
      })
      createInterface({ input: child.stdout }).on("line", (line) => {
        const record = JSON.parse(line)
        if (record.method === "engine.log") methods.push(record.params.message)
      })
      return child
    },
  })
  const resourceLoader = new DefaultResourceLoader({
    cwd: home,
    agentDir: join(home, "agent"),
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
    sessionContext: options.sessionContext,
    extensionFactories: [composeOmoSenpiExtension([component, ...options.components ?? []], {
      env: {},
      logger: { info() {}, warn() {}, error() {} },
    })],
  })
  await resourceLoader.reload()
  const { session } = await createAgentSession({
    cwd: home,
    agentDir: join(home, "agent"),
    settingsManager,
    resourceLoader,
    sessionManager: SessionManager.inMemory(home),
  })
  await session.bindExtensions({
    mode: "rpc",
    onError: error => { extensionErrors.push(error) },
  })
  const observe = () => {
    const runner = session.extensionRunner
    if (runner === undefined) throw new Error("The real session did not bind its extension runner")
    return runner.onRpcEvent((event) => {
      if (event.name === "omo.computer.permission_required" || event.name === "computer.permission_required") events.push(event)
    })
  }
  let off = observe()
  session.setActiveToolsByName(["computer", "computer_actions", "eval"])
  return {
    home,
    session,
    events,
    extensionErrors,
    methods,
    execute: (name: string, params: unknown) =>
      session.executeTool(name, params, { signal: AbortSignal.timeout(60_000) }),
    async reload() {
      off()
      await session.reload()
      off = observe()
      session.setActiveToolsByName(["computer", "computer_actions", "eval"])
    },
    async close() {
      off()
      await session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" })
      session.dispose()
      await rm(home, { recursive: true, force: true })
    },
  }
}
