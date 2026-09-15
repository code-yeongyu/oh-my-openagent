import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { z } from "zod"
import { patchRpcCloseOrdering } from "../bin/lib/rpc-close-ordering.js"

export const rpcRoot = join(import.meta.dir, "../../../node_modules/@code-yeongyu/senpi/dist/modes/rpc")

export const terminalRecord = z.object({
  type: z.string(),
  command: z.string().optional(),
  success: z.boolean().optional(),
  sessionId: z.string().optional(),
  error: z.string().optional(),
})

export type ListedSession = { readonly sessionId: string; readonly status: string }

type HeldWorker = {
  emit: (event: "error", error: Error) => boolean
  release: (code?: number) => void
}

type FakeWorkerModule = {
  instances: HeldWorker[]
  Worker: { sessionPath: string; snapshot: { state: object; sessionPath: string; liveSessionPaths: string[] } }
}

type WorkerClient = {
  bind: (sessionId: string, writer: object, requestClose: () => void, options: object) => Promise<unknown>
}

export type HeldRegistry = {
  openSession: (profile: { cwd: string; sessionPath: string }) => Promise<{ sessionId: string }>
  peek: (sessionId: string) => { worker: WorkerClient } | undefined
  list: () => ListedSession[]
}

export type TerminalPublication = {
  readonly record: z.infer<typeof terminalRecord>
  readonly sessionsAtPublication: ListedSession[]
}

const fakeWorkerSource = `import { EventEmitter } from "node:events"
export const instances = []
export class Worker extends EventEmitter {
  constructor() {
    super()
    this.exitHeld = Promise.withResolvers()
    instances.push(this)
  }
  postMessage(message) {
    const request = message.request
    queueMicrotask(() => {
      if (message.type === "prepare") {
        this.emit("message", { type: "prepared", request, sessionPath: Worker.sessionPath })
        return
      }
      if (message.type === "commit") {
        this.emit("message", { type: "ready", request, snapshot: Worker.snapshot })
        return
      }
      if (message.type === "bind" || message.type === "command") {
        this.emit("message", { type: "result", request })
      }
    })
  }
  terminate() { return this.exitHeld.promise }
  release(code = 1) {
    this.emit("exit", code)
    this.exitHeld.resolve(code)
  }
}
`

const unpatchedFail = `    fail(error) {
        if (this.stopped)
            return;
        this.callbacks.failure(error);
        if (this.writer && this.sessionId) {
            this.writer.enqueue(this.sessionId, { type: "session_error", error });
            this.writer.closeSession(this.sessionId, {
                type: "response",
                command: "close_session",
                success: false,
                error,
            });
        }
        this.quarantine();
    }`

const unpatchedExit = `                this.listeners.clear();
                callbacks.exit();
                resolve();`

/** Start from upstream fail/exit so the helper, not node_modules, owns publication order. */
function seedUnpatchedClient(source: string): string {
  if (!source.includes("pendingTerminal")) return source
  const withoutFail = source.replace(/    fail\(error\) \{[\s\S]*?this\.quarantine\(\);\n    \}/, unpatchedFail)
  const next = withoutFail.replace(
    /                this\.listeners\.clear\(\);\n                callbacks\.exit\(\);[\s\S]*?                resolve\(\);/,
    unpatchedExit,
  )
  if (next.includes("pendingTerminal")) throw new Error("failed to seed unpatched client")
  return next
}

function rewriteSpecifiers(source: string, origin: string, replacements: ReadonlyMap<string, string>): string {
  return source.replace(/from "([^"]+)"/g, (_match, specifier: string) => {
    const overridden = replacements.get(specifier)
    if (overridden !== undefined) return `from ${JSON.stringify(overridden)}`
    if (specifier.startsWith("node:")) return `from ${JSON.stringify(specifier)}`
    return `from ${JSON.stringify(import.meta.resolve(specifier, origin))}`
  })
}

export const turnBoundary = () => new Promise<void>((resolve) => setImmediate(resolve))

/** Real openSession + exit callback; only the worker transport is a held EventEmitter. */
export async function registryWithHeldWorker() {
  const root = await mkdtemp(join(tmpdir(), "omo-close-held-"))
  const rpcDir = join(root, "dist/modes/rpc")
  await mkdir(rpcDir, { recursive: true })
  const clientOrigin = join(rpcRoot, "session-worker-client.js")
  const registryOrigin = join(rpcRoot, "worker-session-registry.js")
  await writeFile(join(rpcDir, "session-worker-client.js"), seedUnpatchedClient(await readFile(clientOrigin, "utf8")))
  await writeFile(join(rpcDir, "worker-session-registry.js"), await readFile(registryOrigin, "utf8"))
  patchRpcCloseOrdering(root)
  const fakeWorkerPath = join(root, "fake-worker.mjs")
  await writeFile(fakeWorkerPath, fakeWorkerSource)
  const clientHref = pathToFileURL(join(rpcDir, "session-worker-client.js")).href
  const fakeHref = pathToFileURL(fakeWorkerPath).href
  await writeFile(
    join(rpcDir, "session-worker-client.js"),
    rewriteSpecifiers(await readFile(join(rpcDir, "session-worker-client.js"), "utf8"), clientOrigin, new Map([["node:worker_threads", fakeHref]])),
  )
  await writeFile(
    join(rpcDir, "worker-session-registry.js"),
    rewriteSpecifiers(await readFile(join(rpcDir, "worker-session-registry.js"), "utf8"), registryOrigin, new Map([["./session-worker-client.js", clientHref]])),
  )
  const [{ WorkerSessionRegistry }, fake] = await Promise.all([
    import(pathToFileURL(join(rpcDir, "worker-session-registry.js")).href),
    import(fakeHref),
  ])
  const heldFake: FakeWorkerModule = fake
  const registry: HeldRegistry = new WorkerSessionRegistry({ configuration: {}, closeGraceMs: 1, now: () => 0 })
  return {
    root,
    fake: heldFake,
    registry,
    [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }),
  }
}

/** Real openSession + exit callback, with a writer that snapshots registry ownership. */
export async function boundHeldSession(loaded: Awaited<ReturnType<typeof registryWithHeldWorker>>) {
  const { SessionEventWriter } = await import(`${rpcRoot}/session-event-writer.js`)
  const sessionPath = join(loaded.root, "review-session.jsonl")
  loaded.fake.Worker.sessionPath = sessionPath
  loaded.fake.Worker.snapshot = {
    state: { sessionId: "durable", cwd: loaded.root, sessionFile: sessionPath },
    sessionPath,
    liveSessionPaths: [sessionPath],
  }
  const opened = await loaded.registry.openSession({ cwd: loaded.root, sessionPath })
  const worker = loaded.fake.instances[0]
  if (worker === undefined) throw new Error("openSession did not construct a worker")
  const entry = loaded.registry.peek(opened.sessionId)
  if (entry === undefined) throw new Error("openSession did not retain the worker")
  const publications: TerminalPublication[] = []
  const writer = new SessionEventWriter((line: string) => {
    publications.push({
      record: terminalRecord.parse(JSON.parse(line)),
      sessionsAtPublication: loaded.registry.list().map((session) => ({
        sessionId: session.sessionId,
        status: session.status,
      })),
    })
  })
  await entry.worker.bind(opened.sessionId, writer, () => undefined, {})
  return { opened, worker, publications, writer }
}
