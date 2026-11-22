import { mkdirSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { runWithRequestContext } from "../request-context.js"
import { LspClient } from "./client.js"
import { INIT_TIMEOUT_MS } from "./constants.js"
import { ControlledClock } from "./controlled-clock-test-support.js"
import { aggregateDiagnosticsForDirectory } from "./directory-diagnostics.js"
import { LspManager } from "./manager.js"
import type { Diagnostic, ResolvedServer } from "./types.js"
import { contextFor, createTypescriptProjects } from "./typescript-project-test-support.js"

const projects = createTypescriptProjects("lsp-dir-group-scan-")
const managers: LspManager[] = []

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.stopAll()
  projects.cleanup()
})

const server: ResolvedServer = { id: "typescript", command: ["fake-ts-ls"], extensions: [".ts"], priority: 1 }

interface FakeBehavior {
  readonly start?: () => Promise<void>
  readonly diagnostics?: (file: string) => Promise<Diagnostic[]>
  readonly stop?: () => Promise<void>
}

class FakeGroupClient extends LspClient {
  stopCount = 0

  constructor(
    root: string,
    private readonly behavior: FakeBehavior,
  ) {
    super(root, server)
  }

  override async start(): Promise<void> {
    await this.behavior.start?.()
  }

  override async initialize(): Promise<void> {}

  override async stop(): Promise<void> {
    this.stopCount += 1
    await this.behavior.stop?.()
  }

  override isAlive(): boolean {
    return true
  }

  override async diagnostics(file: string): Promise<{ readonly items: Diagnostic[] }> {
    return { items: (await this.behavior.diagnostics?.(file)) ?? [diagnostic(file)] }
  }
}

/** One package directory per name under a fresh session root; each package is its own workspace root. */
function sessionWithPackages(names: readonly string[], filesPerPackage: number) {
  const session = projects.makeProject()
  const files = new Map<string, string[]>()
  for (const name of names) {
    const packageDir = join(session, name)
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, "package.json"), "{}\n")
    const packageFiles = Array.from({ length: filesPerPackage }, (_, index) => join(packageDir, `f${index}.ts`))
    for (const file of packageFiles) writeFileSync(file, "export {}\n")
    files.set(packageDir, packageFiles)
  }
  return { session, files }
}

function newManager(clientFactory: (root: string) => LspClient): LspManager {
  const manager = new LspManager({ clientFactory, reaperIntervalMs: 3_600_000 })
  managers.push(manager)
  return manager
}

function referencedClients(manager: LspManager): number {
  return manager.getSnapshot().reduce((sum, client) => sum + client.refCount, 0)
}

describe("directory diagnostics scoped to each server group", () => {
  test("#given a group whose client never finishes starting before a healthy group #when scanning #then the healthy group is diagnosed first and only the slow group's files time out", async () => {
    // given: the slow group has more files than there are workers and comes first
    const { session, files } = sessionWithPackages(["slow", "fast"], 5)
    const slowRoot = join(session, "slow")
    const fastRoot = join(session, "fast")
    const fastChecked = deferred()
    let fastCount = 0
    const clients = new Map<string, FakeGroupClient>()
    const manager = newManager((root) => {
      const client = new FakeGroupClient(
        root,
        root === slowRoot
          ? { start: () => new Promise<void>(() => {}) }
          : {
              diagnostics: async (file) => {
                fastCount += 1
                if (fastCount === 5) fastChecked.resolve()
                return [diagnostic(file)]
              },
            },
      )
      clients.set(root, client)
      return client
    })
    const clock = new ControlledClock()

    // when
    const scan = runWithRequestContext(contextFor(session), () =>
      aggregateDiagnosticsForDirectory(session, ".ts", "all", 50, {
        manager,
        server,
        timers: clock,
        listFiles: () => [...(files.get(slowRoot) ?? []), ...(files.get(fastRoot) ?? [])],
      }),
    )
    await within(fastChecked.promise, "the healthy group was never diagnosed while the slow group was starting")
    const fastDoneAt = clock.now()
    await clock.waitForTimer(INIT_TIMEOUT_MS)
    clock.advanceBy(INIT_TIMEOUT_MS)
    const result = await scan

    // then
    expect(fastDoneAt).toBe(0)
    expect(result.totalDiagnostics).toBe(5)
    expect(result.fileFailures.map((failure) => failure.file).toSorted()).toEqual(files.get(slowRoot) ?? [])
    expect(result.fileFailures.every((failure) => failure.error.includes(`within ${INIT_TIMEOUT_MS}ms`))).toBe(true)
    expect(manager.getSnapshot().map((client) => [client.root, client.refCount])).toEqual([[fastRoot, 0]])
    expect(clients.get(slowRoot)?.stopCount).toBe(1)
  })

  test("#given many groups with a failing start and a failing file #when scanning #then referenced clients stay within the worker limit and all are released", async () => {
    // given
    const names = Array.from({ length: 10 }, (_, index) => `p${index}`)
    const { session, files } = sessionWithPackages(names, 2)
    let maxReferenced = 0
    const manager: LspManager = newManager(
      (root) =>
        new FakeGroupClient(root, {
          ...(root.endsWith("p3") ? { start: async () => Promise.reject(new Error("p3 cannot start")) } : {}),
          diagnostics: async (file) => {
            maxReferenced = Math.max(maxReferenced, referencedClients(manager))
            await Promise.resolve()
            if (file.endsWith(join("p5", "f0.ts"))) throw new Error("p5 file failed")
            return [diagnostic(file)]
          },
        }),
    )

    // when
    const result = await runWithRequestContext(contextFor(session), () =>
      aggregateDiagnosticsForDirectory(session, ".ts", "all", 50, {
        manager,
        server,
        listFiles: () => [...files.values()].flat(),
      }),
    )

    // then
    expect(maxReferenced).toBeGreaterThan(0)
    expect(maxReferenced).toBeLessThanOrEqual(4)
    expect(referencedClients(manager)).toBe(0)
    expect(result.totalDiagnostics).toBe(17)
    expect(result.fileFailures.map((failure) => failure.error).toSorted()).toEqual([
      "p3 cannot start",
      "p3 cannot start",
      "p5 file failed",
    ])
  })

  test("#given four groups whose clients never start ahead of a healthy group #when the start deadline passes #then the scan finishes at the deadline while the stalled clients' shutdown stays tracked", async () => {
    // given: stopping a stalled client takes until `shutdown` resolves; a second start of a root succeeds
    const { session, files } = sessionWithPackages(["s0", "s1", "s2", "s3", "fast"], 1)
    const fastRoot = join(session, "fast")
    const shutdown = deferred()
    const log: string[] = []
    const manager = newManager((root) => {
      const name = basename(root)
      const generation = log.filter((event) => event.startsWith(`spawn:${name}#`)).length + 1
      log.push(`spawn:${name}#${generation}`)
      if (root === fastRoot || generation > 1) return new FakeGroupClient(root, {})
      return new FakeGroupClient(root, {
        start: () => new Promise<void>(() => {}),
        stop: async () => {
          await shutdown.promise
          log.push(`stopped:${name}`)
        },
      })
    })
    const clock = new ControlledClock()
    const scan = runWithRequestContext(contextFor(session), () =>
      aggregateDiagnosticsForDirectory(session, ".ts", "all", 50, {
        manager,
        server,
        timers: clock,
        listFiles: () => [...files.values()].flat(),
      }),
    )
    await clock.waitForScheduled(4)

    try {
      // when
      clock.advanceBy(INIT_TIMEOUT_MS)
      let result: Awaited<typeof scan> | undefined
      await within(
        scan.then((value) => {
          result = value
        }),
        "the scan did not finish at the start deadline while the stalled clients were still stopping",
      )

      // then: timeouts reported and the healthy group diagnosed at the deadline, no stop finished yet
      expect(clock.now()).toBe(INIT_TIMEOUT_MS)
      expect(result?.totalDiagnostics).toBe(1)
      expect(result?.fileFailures.map((failure) => failure.error)).toEqual(
        Array.from({ length: 4 }, () => `typescript did not start within ${INIT_TIMEOUT_MS}ms`),
      )
      expect(log.filter((event) => event.startsWith("stopped:"))).toEqual([])
      expect(manager.getSnapshot().map((client) => [client.root, client.refCount])).toEqual([[fastRoot, 0]])

      // then: the manager still tracks each stop, so a stalled root restarts only after it finished
      const reacquired = manager.getClient(join(session, "s0"), server)
      shutdown.resolve()
      await reacquired
      manager.releaseClient(join(session, "s0"), server)
      expect(log.indexOf("stopped:s0")).toBeLessThan(log.indexOf("spawn:s0#2"))
      await manager.stopAll()
      expect(log.filter((event) => event.startsWith("stopped:")).toSorted()).toEqual(
        ["s0", "s1", "s2", "s3"].map((name) => `stopped:${name}`),
      )
      expect(referencedClients(manager)).toBe(0)
    } finally {
      shutdown.resolve()
    }
  })

  test("#given a scan and another caller waiting on one cold start #when the scan's start deadline passes #then the other caller still gets the started client", async () => {
    // given
    const shared = await coldStartSharedWithScan()
    const other = shared.manager.getClient(shared.root, server)

    // when
    const scanError = await shared.passDeadline()
    shared.started.resolve()
    const client = await other

    // then
    expect(String(scanError)).toContain(`did not start within ${INIT_TIMEOUT_MS}ms`)
    expect(shared.clients).toHaveLength(1)
    expect<unknown>(client).toBe(shared.clients[0])
    expect(shared.clients[0]?.stopCount).toBe(0)
    expect(shared.manager.getSnapshot().map((entry) => [entry.root, entry.refCount, entry.isInitializing])).toEqual([
      [shared.root, 1, false],
    ])
    shared.manager.releaseClient(shared.root, server)
  })

  test("#given a scan and another caller waiting on one cold start #when the deadline passes and then the other caller aborts #then the startup is stopped only once its last waiter left", async () => {
    // given
    const shared = await coldStartSharedWithScan()
    const controller = new AbortController()
    const other = shared.manager.getClient(shared.root, server, controller.signal)

    // when: the scan's waiter leaves first
    await shared.passDeadline()

    // then
    expect(shared.clients[0]?.stopCount).toBe(0)
    expect(shared.manager.clientCount()).toBe(1)

    // when: the last waiter leaves
    controller.abort()

    // then
    await expect(other).rejects.toHaveProperty("name", "AbortError")
    expect(shared.clients[0]?.stopCount).toBe(1)
    expect(shared.manager.clientCount()).toBe(0)
  })

  test("#given many groups #when the scan is aborted while files are being checked #then it throws the abort after every client is released", async () => {
    // given
    const names = Array.from({ length: 10 }, (_, index) => `p${index}`)
    const { session, files } = sessionWithPackages(names, 2)
    const controller = new AbortController()
    let maxReferenced = 0
    let checked = 0
    const manager: LspManager = newManager(
      (root) =>
        new FakeGroupClient(root, {
          diagnostics: async (file) => {
            maxReferenced = Math.max(maxReferenced, referencedClients(manager))
            checked += 1
            if (checked === 6) controller.abort()
            await Promise.resolve()
            return [diagnostic(file)]
          },
        }),
    )

    // when
    const scan = runWithRequestContext(contextFor(session), () =>
      aggregateDiagnosticsForDirectory(session, ".ts", "all", 50, {
        manager,
        server,
        signal: controller.signal,
        listFiles: () => [...files.values()].flat(),
      }),
    )

    // then
    const outcome = await scan.catch((error: unknown) => error)
    expect(outcome).toBe(controller.signal.reason)
    expect(controller.signal.reason).toHaveProperty("name", "AbortError")
    expect(checked).toBeLessThan(20)
    expect(maxReferenced).toBeLessThanOrEqual(4)
    expect(referencedClients(manager)).toBe(0)
  })
})

/** One package whose client starts when `started` resolves; the scan is the first waiter on that start. */
async function coldStartSharedWithScan() {
  const { session, files } = sessionWithPackages(["shared"], 1)
  const root = join(session, "shared")
  const started = deferred()
  const spawned = deferred()
  const clients: FakeGroupClient[] = []
  const manager = newManager((clientRoot) => {
    const client = new FakeGroupClient(clientRoot, { start: () => started.promise })
    clients.push(client)
    spawned.resolve()
    return client
  })
  const clock = new ControlledClock()
  const scan = runWithRequestContext(contextFor(session), () =>
    aggregateDiagnosticsForDirectory(session, ".ts", "all", 50, {
      manager,
      server,
      timers: clock,
      listFiles: () => files.get(root) ?? [],
    }),
  )
  await within(spawned.promise, "the scan never started the shared client")
  const passDeadline = async (): Promise<unknown> => {
    await clock.waitForTimer(INIT_TIMEOUT_MS)
    clock.advanceBy(INIT_TIMEOUT_MS)
    return scan.then(
      () => new Error("the scan succeeded without a started client"),
      (error: unknown) => error,
    )
  }
  return { root, started, clients, manager, passDeadline }
}

function diagnostic(message: string): Diagnostic {
  return { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message }
}

interface Deferred {
  readonly promise: Promise<void>
  resolve(): void
}

function deferred(): Deferred {
  let resolvePromise: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: () => resolvePromise?.() }
}

/** Circuit breaker only: fails with `message` when the awaited signal never arrives. */
async function within(promise: Promise<void>, message: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 5_000)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
