// Child-process fixture for hand-browser-placement.test.ts: runs one session turn whose model issues a shell call,
// through the engine's real split-local path (a remote ToolHost linked in process to a real hand with no builtin
// extensions), and prints the tool results as JSON. It runs in its own process so the engine's process-wide state
// never reaches other tests. argv: <hand root> <agent dir>.

import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const [handRoot, agentDir] = process.argv.slice(2)
if (handRoot === undefined || agentDir === undefined) throw new Error("usage: hand-browser-placement.test-fixture.ts <hand root> <agent dir>")

const senpiDist = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const storeModules = join(senpiDist, "..", "..", "..")
async function load<T>(path: string): Promise<T> {
  return (await import(pathToFileURL(path).href)) as T
}

interface AgentLike {
  prompt(text: string): Promise<void>
  readonly state: { readonly messages: ReadonlyArray<{ readonly role: string; readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }> }> }
}
interface Core {
  Agent: new (options: Record<string, unknown>) => AgentLike
  createInProcessNetwork(): { listen(endpoint: unknown, side: unknown): () => void; dial(endpoint: unknown, side: unknown): { connect(): void; drop(): void } }
  createReliableTransport(options: Record<string, unknown>): unknown
  createRemoteExecutor(options: Record<string, unknown>): { close(): Promise<void> }
  createRemoteToolHost(options: Record<string, unknown>): unknown
  localEndpoint(platform: string, id: string, root: string): unknown
}

const core = await load<Core>(join(storeModules, "@earendil-works", "pi-agent-core", "dist", "index.js"))
const ai = await load<{ createAssistantMessageEventStream(): { push(event: unknown): void } }>(join(storeModules, "@earendil-works", "pi-ai", "dist", "index.js"))
const { parseArgs } = await load<{ parseArgs(argv: string[]): unknown }>(join(senpiDist, "cli", "args.js"))
const { createLooplessHandScopes } = await load<{ createLooplessHandScopes(configuration: unknown, local: { extensionFactories: unknown[] }): unknown }>(join(senpiDist, "modes", "rpc", "remote-executor-scope.js"))

const transportSide = (): unknown =>
  core.createReliableTransport({
    clock: { now: () => Date.now(), setTimer: (callback: () => void, ms: number) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer) } },
    onHandlerError: (error: unknown) => { throw error },
  })

const model = { id: "faux", name: "faux", api: "openai-completions", provider: "fixture", baseUrl: "https://example.invalid", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }
function turn(content: ReadonlyArray<Record<string, unknown>>) {
  const toolUse = content.some((part) => part.type === "toolCall")
  const stream = ai.createAssistantMessageEventStream()
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
  stream.push({ type: "done", reason: toolUse ? "toolUse" : "stop", message: { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: 1, content, stopReason: toolUse ? "toolUse" : "stop", usage } })
  return stream
}

const network = core.createInProcessNetwork()
const endpoint = core.localEndpoint("linux", `hand-${crypto.randomUUID()}`, "/tmp")
const brain = transportSide()
const hand = transportSide()
const stop = network.listen(endpoint, hand)
const link = network.dial(endpoint, brain)
link.connect()
const configuration = { parsed: parseArgs(["--mode", "rpc", "--no-skills", "--no-context-files", "--no-prompt-templates", "--no-extensions"]), cwd: handRoot, agentDir, appMode: "rpc" }
const executor = core.createRemoteExecutor({ authority: { kind: "self" }, transport: hand, openScope: createLooplessHandScopes(configuration, { extensionFactories: [] }), onFault: (error: unknown) => { throw error } })
let turns = 0
const session = new core.Agent({
  initialState: { model, tools: [] },
  streamFn: () => turn(turns++ === 0 ? [{ type: "toolCall", id: "browse-1", name: "bash", arguments: { command: "pwd" } }] : [{ type: "text", text: "done" }]),
  toolHost: core.createRemoteToolHost({ transport: brain, placement: "split-local" }),
  executionScope: { id: `scope-${crypto.randomUUID()}`, root: handRoot },
})
await session.prompt("open the page with the browser skill")
const results = session.state.messages.filter((message) => message.role === "toolResult").map((message) => message.content.map((part) => part.text ?? "").join("").trim())
await executor.close()
link.drop()
stop()
process.stdout.write(`${JSON.stringify({ results })}\n`)
process.exit(0)
