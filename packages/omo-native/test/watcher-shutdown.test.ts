import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { immediateTurn, watcherFixture } from "./watcher-shutdown-fixture"

class GatedWorker extends EventEmitter {
  readonly commands: unknown[] = []
  readonly exit = Promise.withResolvers<number>()
  postMessage(command: unknown) { this.commands.push(command) }
  terminate() { return this.exit.promise }
}

describe("config watcher shutdown", () => {
  test("cancels queued registration when shutdown reaches a worker before it starts watching", async () => {
    // Given the actual worker message handler, held before consuming watch requests.
    await using fixture = await watcherFixture()
    const worker = new GatedWorker()
    const port = new EventEmitter()
    let registrations = 0
    new Function("require", fixture.events.RECURSIVE_WATCH_WORKER_SOURCE)((specifier: string) => {
      switch (specifier) {
        case "node:fs": return { watch: () => { registrations++; return new EventEmitter() } }
        case "node:worker_threads": return { parentPort: port }
        default: throw new Error(`Unexpected worker import: ${specifier}`)
      }
    })
    const subscribe = fixture.events.createFsWatchEventSource(undefined, { platform: "darwin", createRecursiveWorker: () => worker })
    const unsubscribe = subscribe(fixture.root, () => undefined)
    try {
      // When shutdown cancels the subscription before queued work is dispatched.
      const closing = Promise.resolve(unsubscribe())
      for (const command of worker.commands) port.emit("message", command)
      worker.exit.resolve(0)
      await closing
      // Then the real worker handler does not enter fs.watch in the shutdown window.
      expect(registrations).toBe(0)
    } finally { worker.exit.resolve(0) }
  })

  test("awaits worker termination when the last subscription is removed", async () => {
    // Given a worker whose termination completion is explicitly gated.
    await using fixture = await watcherFixture()
    const worker = new GatedWorker()
    const subscribe = fixture.events.createFsWatchEventSource(undefined, { platform: "darwin", createRecursiveWorker: () => worker })
    const unsubscribe = subscribe(fixture.root, () => undefined)
    let completed = false
    try {
      // When the final unsubscribe begins and the event loop reaches its next turn.
      const closing = Promise.resolve(unsubscribe()).then(() => { completed = true })
      await immediateTurn()
      const completedBeforeExit = completed
      worker.exit.resolve(0)
      await closing
      // Then native worker teardown, not merely dispatching terminate, owns completion.
      expect(completedBeforeExit).toBe(false)
    } finally { worker.exit.resolve(0) }
  })

  test("joins asynchronous unsubscribe on repeated engine close", async () => {
    // Given a real engine with an asynchronous event-source disposer.
    await using fixture = await watcherFixture()
    const released = Promise.withResolvers<void>()
    const unsubscribed = Promise.withResolvers<void>()
    const callbacks: Array<() => void> = []
    const engine = new fixture.engine.ConfigReloadWatchEngine({
      targets: [{ id: "test", kind: "dir", path: fixture.root }],
      subscribe: () => () => { unsubscribed.resolve(); return released.promise },
      onRealChange: () => undefined,
      clock: { setTimeout: (callback: () => void) => callbacks.push(callback), clearTimeout: () => undefined },
    })
    let completed = false
    try {
      // When shutdown is requested twice before the unsubscribe promise resolves.
      const closing = Promise.all([engine.close(), engine.close()]).then(() => { completed = true })
      for (const callback of callbacks) callback()
      await unsubscribed.promise
      await immediateTurn()
      const completedBeforeRelease = completed
      released.resolve()
      await closing
      // Then both callers join the same outstanding teardown.
      expect(completedBeforeRelease).toBe(false)
    } finally { released.resolve() }
  })

  test("drains config subscriptions before session_shutdown completes", async () => {
    // Given the actual extension lifecycle wired to an asynchronous event source.
    await using fixture = await watcherFixture()
    const agentDir = join(fixture.root, "agent")
    await mkdir(agentDir)
    await writeFile(join(agentDir, "settings.json"), "{}")
    const handlers = new Map<string, (event: object, context?: object) => unknown>()
    const bus = new EventEmitter()
    const released = Promise.withResolvers<void>()
    const unsubscribed = Promise.withResolvers<void>()
    const callbacks: Array<() => void> = []
    fixture.extension.configReloadExtension({
      on: (event: string, handler: (event: object, context?: object) => unknown) => handlers.set(event, handler),
      events: { on: (event: string, callback: () => void) => { bus.on(event, callback); return () => bus.off(event, callback) }, emit: (event: string, payload: unknown) => bus.emit(event, payload) },
    }, {
      agentDir,
      subscribe: () => () => { unsubscribed.resolve(); return released.promise },
      clock: { setTimeout: (callback: () => void) => callbacks.push(callback), clearTimeout: () => undefined },
      logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: (event: string) => { throw new Error(event) } },
    })
    await handlers.get("session_start")?.({ reason: "startup" }, {
      cwd: fixture.root, mode: "rpc", isProjectTrusted: () => false,
      sessionManager: { getSessionId: () => "watch-test", getSessionFile: () => join(fixture.root, "session.jsonl") },
    })
    let completed = false
    try {
      // When the session ends while event-source disposal is outstanding.
      const closing = Promise.resolve(handlers.get("session_shutdown")?.({ reason: "quit" })).then(() => { completed = true })
      for (const callback of callbacks) callback()
      await unsubscribed.promise
      await immediateTurn()
      const completedBeforeRelease = completed
      released.resolve()
      await closing
      // Then the engine cannot proceed to process.exit before watchers are gone.
      expect(completedBeforeRelease).toBe(false)
    } finally { released.resolve() }
  })

  test.each([false, true])("watches only persistent RPC sessions (persistent=%s)", async (persistent) => {
    // Given an RPC session using the real config-reload extension.
    await using fixture = await watcherFixture()
    const agentDir = join(fixture.root, "agent")
    await mkdir(agentDir)
    await writeFile(join(agentDir, "settings.json"), "{}")
    const handlers = new Map<string, (event: object, context?: object) => unknown>()
    const bus = new EventEmitter()
    let subscriptions = 0
    fixture.extension.configReloadExtension({
      on: (event: string, handler: (event: object, context?: object) => unknown) => handlers.set(event, handler),
      events: { on: (event: string, callback: () => void) => { bus.on(event, callback); return () => bus.off(event, callback) }, emit: (event: string, payload: unknown) => bus.emit(event, payload) },
    }, {
      agentDir,
      subscribe: () => { subscriptions++; return () => undefined },
      logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: (event: string) => { throw new Error(event) } },
    })
    try {
      // When the host starts a durable session or a --no-session probe.
      await handlers.get("session_start")?.({ reason: "startup" }, {
        cwd: fixture.root, mode: "rpc", isProjectTrusted: () => false,
        sessionManager: { getSessionId: () => "probe", getSessionFile: () => persistent ? join(fixture.root, "session.jsonl") : undefined },
      })
      // Then probes avoid native watchers, without disabling durable RPC watching.
      expect(subscriptions > 0).toBe(persistent)
    } finally {
      await handlers.get("session_shutdown")?.({ reason: "quit" })
    }
  })
})
