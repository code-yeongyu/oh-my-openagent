import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createGatewayStore } from "../../packages/omo-senpi/src/components/thread/gateway/store"
import { registerThreadTools, type ThreadHost } from "../../packages/omo-senpi/src/components/thread/tools"
import {
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from "../../packages/omo-senpi/src/senpi-test-runtime"
import type { DiscoveredTool } from "./tool-check"

// The tool registry of a test engine session from the pinned engine (design 7.2): a session with the thread component
// against one without it, so the difference is exactly what omo registers, a tool added at run time included. The host
// is a fake that answers nothing; no network, no account and no model call is involved.

type ExtensionFactory = NonNullable<ConstructorParameters<typeof DefaultResourceLoader>[0]["extensionFactories"]>[number]

const idleHost = (root: string): ThreadHost => ({
  socket: join(root, "parity.sock"),
  listSessions: async () => [],
  openSession: async () => {
    throw new Error("the parity registry session opens no thread")
  },
  getMessages: async () => [],
  getState: async () => ({ isStreaming: false }),
  prompt: async () => ({ turnId: "none" }),
  interrupt: async () => ({ interrupted: false }),
  setSessionName: async () => {},
  setModel: async (_session: string, provider: string, id: string) => ({ provider, id, name: id }),
  getAvailableModels: async () => [],
  setThinkingLevel: async () => {},
  getAvailableThinkingLevels: async () => [],
})

async function sessionTools(root: string, factories: readonly ExtensionFactory[]): Promise<DiscoveredTool[]> {
  const agentDir = mkdtempSync(join(root, "agent-"))
  const settingsManager = SettingsManager.inMemory({ defaultProjectTrust: "always", enabledBuiltinExtensions: [] })
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [...factories],
  })
  await loader.reload()
  const { session } = await createAgentSession({
    cwd: root,
    agentDir,
    settingsManager,
    modelRegistry: new ModelRegistry(ModelRuntime.createSync({ modelsPath: null })),
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(root),
    autoTitleSessions: false,
  })
  try {
    await session.bindExtensions({ mode: "print" })
    return session.getAllTools().map((tool) => ({ name: tool.name, parameters: JSON.parse(JSON.stringify(tool.parameters)) }))
  } finally {
    session.dispose()
    await session.whenToolChildClosed()
  }
}

export async function discoverOmoTools(): Promise<DiscoveredTool[]> {
  const root = mkdtempSync(join(tmpdir(), "sdk-parity-tools-"))
  const gatewayDir = join(root, "gateway")
  mkdirSync(gatewayDir)
  const store = createGatewayStore({ agentDir: gatewayDir })
  try {
    const threads: ExtensionFactory = (pi) => {
      registerThreadTools(pi as unknown as Parameters<typeof registerThreadTools>[0], {
        host: idleHost(root),
        store,
        stateDirectory: root,
        callerSessionId: () => "parity",
        callerWorkspaceRoot: () => root,
      })
    }
    const engineOnly = new Set((await sessionTools(root, [])).map((tool) => tool.name))
    return (await sessionTools(root, [threads])).filter((tool) => !engineOnly.has(tool.name))
  } finally {
    await store.dispose()
    rmSync(root, { recursive: true, force: true })
  }
}
