import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { REPO_ROOT } from "./registry"
import type { DiscoveredTool } from "./tool-check"

// The tool registry of a test engine session from a tree's pinned engine (design 7.2): a session with the thread
// component against one without it, so the difference is exactly what omo registers, a tool added at run time included.
// The tree is a parameter so the gate drives the merge base's own tools with the head's runner. The host is a fake that
// holds no thread; no network, no account and no model call is involved.

type Runtime = typeof import("../../packages/omo-senpi/src/senpi-test-runtime")
type Tools = typeof import("../../packages/omo-senpi/src/components/thread/tools")
type Store = typeof import("../../packages/omo-senpi/src/components/thread/gateway/store")
type ExtensionFactory = NonNullable<
  ConstructorParameters<Runtime["DefaultResourceLoader"]>[0]["extensionFactories"]
>[number]
type Session = Awaited<ReturnType<Runtime["createAgentSession"]>>["session"]

export type ToolSession = {
  readonly tools: readonly DiscoveredTool[]
  readonly execute: (name: string, args: unknown) => Promise<unknown>
  readonly close: () => Promise<void>
}

const idleHost = (root: string) => ({
  socket: join(root, "parity.sock"),
  listSessions: async () => [],
  openSession: async () => {
    throw new Error("the parity session opens no thread")
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

async function engineSession(runtime: Runtime, root: string, factories: readonly ExtensionFactory[]): Promise<Session> {
  const agentDir = mkdtempSync(join(root, "agent-"))
  const settingsManager = runtime.SettingsManager.inMemory({
    defaultProjectTrust: "always",
    enabledBuiltinExtensions: [],
  })
  const loader = new runtime.DefaultResourceLoader({
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
  const { session } = await runtime.createAgentSession({
    cwd: root,
    agentDir,
    settingsManager,
    modelRegistry: new runtime.ModelRegistry(runtime.ModelRuntime.createSync({ modelsPath: null })),
    resourceLoader: loader,
    sessionManager: runtime.SessionManager.inMemory(root),
    autoTitleSessions: false,
  })
  await session.bindExtensions({ mode: "print" })
  return session
}

const toolsOf = (session: Session): DiscoveredTool[] =>
  session.getAllTools().map((tool) => ({ name: tool.name, parameters: JSON.parse(JSON.stringify(tool.parameters)) }))

async function dispose(session: Session): Promise<void> {
  session.dispose()
  await session.whenToolChildClosed()
}

export async function openToolSession(tree: string = REPO_ROOT): Promise<ToolSession> {
  const src = join(tree, "packages/omo-senpi/src")
  const runtime = (await import(join(src, "senpi-test-runtime.ts"))) as Runtime
  const { registerThreadTools } = (await import(join(src, "components/thread/tools.ts"))) as Tools
  const { createGatewayStore } = (await import(join(src, "components/thread/gateway/store.ts"))) as Store
  const root = mkdtempSync(join(tmpdir(), "sdk-parity-tools-"))
  const gatewayDir = join(root, "gateway")
  mkdirSync(gatewayDir)
  const store = createGatewayStore({ agentDir: gatewayDir })
  const threads: ExtensionFactory = (pi) => {
    registerThreadTools(pi as unknown as Parameters<Tools["registerThreadTools"]>[0], {
      host: idleHost(root),
      store,
      stateDirectory: root,
      callerSessionId: () => "parity",
      callerWorkspaceRoot: () => root,
    })
  }
  const bare = await engineSession(runtime, root, [])
  const engineOnly = new Set(toolsOf(bare).map((tool) => tool.name))
  await dispose(bare)
  const session = await engineSession(runtime, root, [threads])
  return {
    tools: toolsOf(session).filter((tool) => !engineOnly.has(tool.name)),
    execute: async (name, args) => {
      const result = await session.executeTool(name, args, { activateInactiveTool: true })
      return (result.details as { readonly result?: unknown } | undefined)?.result ?? result.details
    },
    close: async () => {
      await dispose(session)
      await store.dispose()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

export async function discoverOmoTools(tree: string = REPO_ROOT): Promise<DiscoveredTool[]> {
  const session = await openToolSession(tree)
  try {
    return [...session.tools]
  } finally {
    await session.close()
  }
}
