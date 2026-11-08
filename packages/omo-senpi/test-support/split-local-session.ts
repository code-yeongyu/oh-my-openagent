/// <reference types="bun-types" />

// A real split-local session for omo component tests: the engine's loop (brain) in this process, and a hand on
// loopless runtimes joined to it by the engine's reference transport over an in-process carrier. Both sides load the
// same extension factory, exactly as a split session loads omo; the model is the engine's faux provider.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

type ExtensionFactory = (pi: never) => unknown

const senpiDist = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const scopeDir = join(senpiDist, "..", "..", "..", "@earendil-works")
const importDist = async <T>(path: string): Promise<T> => (await import(pathToFileURL(path).href)) as T

interface Transport { readonly __transport: unique symbol }
interface TransportSide extends Transport { readonly __side: unique symbol }

const core = await importDist<{
  createInProcessNetwork(): { listen(endpoint: unknown, side: TransportSide): () => void; dial(endpoint: unknown, side: TransportSide): { connect(): void; drop(): void } }
  createReliableTransport(options: { clock: { now(): number; setTimer(callback: () => void, ms: number): () => void }; onHandlerError(error: unknown): void }): TransportSide
  createRemoteExecutor(options: { authority: { kind: "self" }; fileChannel: boolean; transport: Transport; openScope: unknown; onFault(error: unknown): void }): { close(): Promise<void> | void }
  createRemoteToolHost(options: { transport: Transport; placement: "split-local"; planes?: Record<string, unknown> }): unknown
  localEndpoint(platform: string, name: string, root: string): unknown
}>(join(scopeDir, "pi-agent-core", "dist", "index.js"))
const ai = await importDist<{
  registerFauxProvider(): { getModel(): { provider: string; id: string }; setResponses(responses: unknown[]): void; unregister?(): void; api: string; models: unknown[] }
  fauxAssistantMessage(content: unknown, options?: { stopReason?: string }): unknown
  fauxToolCall(name: string, args: Record<string, unknown>, options?: { id?: string }): unknown
}>(join(scopeDir, "pi-ai", "dist", "compat.js"))
const args = await importDist<{ parseArgs(argv: string[]): unknown }>(join(senpiDist, "cli", "args.js"))
const scopes = await importDist<{ createLooplessHandScopes(configuration: unknown, local: { extensionFactories: ExtensionFactory[] }): unknown }>(join(senpiDist, "modes", "rpc", "remote-executor-scope.js"))
const forwarding = await importDist<{ EXTENSION_EVENTS_PLANE: string; serveExtensionEvents(runner: unknown): unknown }>(join(senpiDist, "core", "extensions", "two-sided-forwarding.js"))
const sdk = await importDist<{
  createAgentSession(options: Record<string, unknown>): Promise<{ session: SplitSession }>
  DefaultResourceLoader: new (options: Record<string, unknown>) => { reload(): Promise<void>; getExtensions(): { errors: unknown[] } }
  SessionManager: { inMemory(cwd: string): unknown }
  SettingsManager: { inMemory(settings?: Record<string, unknown>): unknown }
  ModelRegistry: new (runtime: unknown) => { registerProvider(name: string, config: Record<string, unknown>): void; find(provider: string, id: string): unknown }
  ModelRuntime: { createSync(options: { modelsPath: null }): unknown }
}>(join(senpiDist, "index.js"))

export interface SplitSession {
  readonly agent: { toolHost?: unknown; toolExecution?: "sequential" | "parallel" }
  readonly extensionRunner: unknown
  readonly sessionManager: { getSessionId(): string }
  prompt(text: string): Promise<void>
  bindExtensions(options: { mode: string }): Promise<void>
  dispose(): Promise<void> | void
}

export type Placement = "fused" | "split-local"

export interface ScriptedSession {
  readonly cwd: string
  readonly sessionId: string
  /** Tool calls the hand executed; always 0 on a fused session. */
  handToolCalls(): number
  /** Runs one prompt whose model answers with `calls` (tool name, arguments) once, then "done". */
  turn(calls: ReadonlyArray<readonly [string, Record<string, unknown>]>): Promise<void>
  close(): Promise<void>
}

export async function openScriptedSession(placement: Placement, extension: ExtensionFactory): Promise<ScriptedSession> {
  return openSession(placement, extension)
}

async function openSession(placement: Placement, extension: ExtensionFactory): Promise<ScriptedSession> {
  const root = mkdtempSync(join(tmpdir(), "omo-split-local-"))
  const cwd = join(root, "project")
  const agentDir = join(root, "agent")
  const handAgentDir = join(root, "hand-agent")
  for (const dir of [cwd, agentDir, handAgentDir]) mkdirSync(dir, { recursive: true })
  const cleanups: Array<() => Promise<void> | void> = [() => rmSync(root, { recursive: true, force: true })]
  const faults: unknown[] = []
  let handToolCalls = 0
  const handProbe: ExtensionFactory = (pi) => {
    (pi as unknown as { on(event: string, handler: () => undefined, options: { runs: "hand" }): void })
      .on("tool_call", () => { handToolCalls += 1; return undefined }, { runs: "hand" })
  }

  const faux = ai.registerFauxProvider()
  const model = faux.getModel()
  const registry = new sdk.ModelRegistry(sdk.ModelRuntime.createSync({ modelsPath: null }))
  registry.registerProvider(model.provider, { baseUrl: "http://127.0.0.1:1", apiKey: "faux-key", api: faux.api, models: faux.models })
  // Both sides run with the same settings and no engine builtins. The hand reads its settings from its agent dir, and
  // left at the defaults it loads every builtin: the bundled ones register process-wide Bun.plugin virtual modules, and
  // its mcp builtin binds the process-wide MCP service, a binding that disposing the hand's runtimes never releases.
  const settings = { defaultProjectTrust: "always", enabledBuiltinExtensions: [] }
  writeFileSync(join(handAgentDir, "settings.json"), JSON.stringify(settings))
  const settingsManager = sdk.SettingsManager.inMemory(settings)
  const loader = new sdk.DefaultResourceLoader({
    cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [extension],
  })
  await loader.reload()
  const loadErrors = loader.getExtensions().errors
  if (loadErrors.length > 0) throw new Error(`extension load errors: ${JSON.stringify(loadErrors)}`)
  const { session } = await sdk.createAgentSession({
    cwd, agentDir, settingsManager, modelRegistry: registry, model: registry.find(model.provider, model.id), thinkingLevel: "off",
    resourceLoader: loader, sessionManager: sdk.SessionManager.inMemory(cwd), autoTitleSessions: false,
  })
  cleanups.push(() => session.dispose())
  await session.bindExtensions({ mode: "print" })
  // One call after another, so a later call in the same turn sees what the earlier call's hooks recorded.
  session.agent.toolExecution = "sequential"

  if (placement === "split-local") {
    const clock = { now: () => Date.now(), setTimer: (callback: () => void, ms: number) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer) } }
    const side = () => core.createReliableTransport({ clock, onHandlerError: (error) => { faults.push(error) } })
    const network = core.createInProcessNetwork()
    const endpoint = core.localEndpoint(process.platform === "win32" ? "win32" : "linux", `hand-${crypto.randomUUID()}`, root)
    const brain = side()
    const hand = side()
    const stop = network.listen(endpoint, hand)
    const link = network.dial(endpoint, brain)
    link.connect()
    cleanups.push(() => { link.drop(); stop() })
    const configuration = {
      parsed: args.parseArgs(["--mode", "rpc", "--no-skills", "--no-context-files", "--no-prompt-templates"]),
      cwd, agentDir: handAgentDir, appMode: "rpc",
    }
    const executor = core.createRemoteExecutor({
      authority: { kind: "self" }, fileChannel: true, transport: hand,
      openScope: scopes.createLooplessHandScopes(configuration, { extensionFactories: [extension, handProbe] }),
      onFault: (error) => { faults.push(error) },
    })
    cleanups.push(() => executor.close())
    session.agent.toolHost = core.createRemoteToolHost({
      transport: brain, placement: "split-local",
      planes: { [forwarding.EXTENSION_EVENTS_PLANE]: forwarding.serveExtensionEvents(session.extensionRunner) },
    })
  }

  let callIndex = 0
  return {
    cwd,
    sessionId: session.sessionManager.getSessionId(),
    handToolCalls: () => handToolCalls,
    async turn(calls) {
      faux.setResponses([
        ai.fauxAssistantMessage(calls.map(([name, callArgs]) => ai.fauxToolCall(name, callArgs, { id: `call-${callIndex++}` })), { stopReason: "toolUse" }),
        ai.fauxAssistantMessage("done"),
      ])
      await session.prompt("go")
      if (faults.length > 0) throw new Error(`hand faults: ${faults.map(String).join("; ")}`)
    },
    async close() {
      for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
      faux.unregister?.()
    },
  }
}
