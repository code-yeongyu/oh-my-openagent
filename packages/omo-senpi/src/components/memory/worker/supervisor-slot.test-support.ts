import { spawn, type ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { existsSync, watch } from "node:fs"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { createServer, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import { readRunJson, readRunTextTail, writeRunJsonAtomic, type RunLaunchManifest, type RunOutcome } from "./run-artifacts"
import { createTestClock, waitForTestState } from "./supervisor-test-signals"

const moduleDir = dirname(fileURLToPath(import.meta.url))

export async function slotHarness(testBudgetMs: number) {
  // All waits share one deadline, leaving the test's final second for teardown.
  const deadline = Date.now() + testBudgetMs - 1_000
  const remaining = () => Math.max(0, deadline - Date.now())
  const root = await mkdtemp(join(tmpdir(), "reflection-slots-"))
  const locks = join(root, "runtime", "locks")
  const tickets = join(locks, "reflection-run.tickets")
  await mkdir(tickets, { recursive: true })
  const sockets = new Map<string, Socket>()
  const events = new EventEmitter()
  const order: string[] = []
  let active = 0
  let peak = 0
  let flowing = false
  const server = createServer((socket) => {
    let received = ""
    const onData = (data: Buffer) => {
      received += data.toString()
      if (!received.includes("\n")) return
      socket.off("data", onData)
      const id = received.trim()
      sockets.set(id, socket)
      order.push(id)
      active += 1
      peak = Math.max(peak, active)
      socket.once("close", () => { active -= 1 })
      events.emit("started")
      if (flowing) socket.end()
    }
    socket.on("data", onData)
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("expected TCP listener")
  const port = address.port
  const processes: ChildProcess[] = []
  const exits: Promise<number | null>[] = []
  const supervisors = new Map<string, {
    closed: boolean
    diagnostic: () => Promise<string>
  }>()

  async function makeRun(id: string, cap = 1, clock?: number) {
    const paths = buildIdentityPaths(root, id)
    const runDir = join(paths.reflection, "runs", id)
    await mkdir(runDir, { recursive: true })
    const now = clock ?? Date.now()
    const clockPath = clock === undefined ? undefined : await createTestClock(runDir, clock)
    const ledger = {
      version: 1, runId: id, attempt: 1, kind: "reflection", trigger: "manual",
      startedAt: new Date(now).toISOString(), queued: true,
      hardDeadlineAt: now + 10_000, terminationGraceMs: 1_000, deadlineAt: now + 11_000,
      mergePolicy: "auto", worktreeDir: paths.repo, worktreeBranch: "unused",
      baseSha: "unused", gitFilePath: join(paths.repo, ".git"), gitFileSnapshot: "",
      commonConfigPath: join(paths.repo, "config"), commonConfigSnapshot: null,
    }
    const manifest: RunLaunchManifest & { queuedAt: number; maxConcurrentRuns: number; memoryRoot: string } = {
      version: 1, runId: id, attempt: 1, kind: "reflection",
      command: process.execPath, args: [join(moduleDir, "__fixtures__", "supervisor-slot-child.ts")],
      cwd: root,
      env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
        OMO_MEMORY_HOME: root, REFLECTION_SLOT_TEST_PORT: String(port), REFLECTION_SLOT_TEST_ID: id },
      hardDeadlineAt: ledger.hardDeadlineAt, terminationGraceMs: 1_000, maxOutputBytes: 65_536,
      stdoutPath: join(runDir, "stdout.log"), stderrPath: join(runDir, "stderr.log"),
      queuedAt: now, maxConcurrentRuns: cap, memoryRoot: root,
    }
    await writeRunJsonAtomic(join(runDir, "ledger.json"), ledger)
    await writeRunJsonAtomic(join(runDir, "launch.json"), manifest)
    return { id, paths, runDir, manifest, ledger, clockPath }
  }

  function launch(run: Awaited<ReturnType<typeof makeRun>>, preload?: string) {
    const child = spawn(process.execPath, [
      ...(preload === undefined ? [] : ["--preload", preload]),
      join(moduleDir, "memory-run-supervisor.ts"), run.runDir,
    ], {
      env: { ...process.env, OMO_MEMORY_HOME: root, ...(run.clockPath === undefined ? {} : {
        OMO_MEMORY_SUPERVISOR_ALLOW_TEST_SEAMS: "1",
        OMO_MEMORY_SUPERVISOR_CLOCK_PATH: run.clockPath,
      }) },
      stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
    })
    processes.push(child)
    let stderr = ""
    let code: number | null = null
    let signal: NodeJS.Signals | null = null
    let error: Error | undefined
    child.stderr?.on("data", (chunk) => { stderr += String(chunk) })
    const supervisor = {
      closed: false,
      diagnostic: async () => [
        `supervisor ${run.id} exited code=${code} signal=${signal}${error === undefined ? "" : ` error=${error.message}`}`,
        `supervisor stderr:\n${stderr}`,
        `outcome.json:\n${await readRunTextTail(join(run.runDir, "outcome.json"), 65_536) || "<missing>"}`,
        `child stderr (${run.manifest.stderrPath}):\n${await readRunTextTail(run.manifest.stderrPath, 65_536) || "<missing>"}`,
      ].join("\n"),
    }
    supervisors.set(run.id, supervisor)
    child.once("error", (cause) => { error = cause; events.emit("supervisor") })
    child.once("close", (exitCode, exitSignal) => {
      code = exitCode
      signal = exitSignal
      supervisor.closed = true
      events.emit("supervisor")
    })
    const exit = waitForTestState((check) => {
      events.on("supervisor", check)
      return () => { events.off("supervisor", check) }
    }, async () => {
      if (error !== undefined || (supervisor.closed && stderr.includes("Unhandled"))) {
        throw new Error(await supervisor.diagnostic())
      }
      return supervisor.closed ? { code } : undefined
    }, remaining(), `supervisor ${run.id} close`).then((result) => result.code)
    // Waits may detect the exit before a test reaches its explicit exit assertion.
    void exit.catch(() => undefined)
    exits.push(exit)
    events.emit("supervisor")
    return { child, exit }
  }

  const wait = <T>(
    probe: () => T | undefined | Promise<T | undefined>,
    description: string,
    directory?: string,
    id?: string,
  ) => {
    // Prior exits (e.g. an intentionally killed queue member) do not
    // invalidate later aggregate waits. A targeted wait still sees a prior exit.
    const previousExits = new Set([...supervisors].filter(([, value]) => value.closed).map(([key]) => key))
    return waitForTestState((check) => {
      events.on("started", check)
      events.on("supervisor", check)
      const watcher = directory === undefined ? undefined : watch(directory, check)
      const recheck = directory === undefined ? undefined : setInterval(check, 25)
      return () => {
        events.off("started", check)
        events.off("supervisor", check)
        watcher?.close()
        clearInterval(recheck)
      }
    }, async () => {
      const value = await probe()
      if (value !== undefined) return value
      for (const [key, supervisor] of supervisors) {
        if (supervisor.closed && (id === undefined ? !previousExits.has(key) : key === id)) {
          throw new Error(`while waiting for ${description}:\n${await supervisor.diagnostic()}`)
        }
      }
      return undefined
    }, remaining(), description)
  }
  return {
    root, locks, tickets, sockets, order, makeRun, launch,
    peak: () => peak,
    waitStarted: (id: string) => wait(() => sockets.has(id) ? true : undefined, `child ${id} started`, undefined, id),
    waitAccounted: (count: number, minimumStarted = 1) => wait(async () =>
      sockets.size >= minimumStarted
      && sockets.size + (await readdir(tickets)).filter((name) => name.endsWith(".ticket")).length === count
        ? true : undefined, `${count} running or queued supervisors`, tickets),
    waitQueued: (count: number) => wait(async () =>
      (await readdir(tickets)).filter((name) => name.endsWith(".ticket")).length === count
        ? true : undefined, `${count} queued supervisors`, tickets),
    release: (id: string) => {
      const socket = sockets.get(id)
      if (socket === undefined) throw new Error(`child ${id} did not start`)
      socket.end()
    },
    flow: () => { flowing = true; for (const socket of sockets.values()) socket.end() },
    outcome: async (runDir: string) => {
      const id = basename(runDir)
      await wait(() => existsSync(join(runDir, "outcome.json")) ? true : undefined,
        `outcome.json in ${runDir}`, runDir, id)
      return readRunJson<RunOutcome>(join(runDir, "outcome.json"))
    },
    cleanup: async () => {
      for (const socket of sockets.values()) socket.end()
      for (const child of processes) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
      await Promise.allSettled(exits)
      // Exit guards may already have timed out. Still reap the real children
      // before removing their run roots, within the reserved cleanup budget.
      await waitForTestState((check) => {
        events.on("supervisor", check)
        return () => { events.off("supervisor", check) }
      }, () => [...supervisors.values()].every((supervisor) => supervisor.closed) ? true : undefined,
      Math.max(0, deadline + 1_000 - Date.now()), "supervisor cleanup")
      for (const socket of sockets.values()) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    },
  }
}
