import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { createServer, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import { readRunJson, writeRunJsonAtomic, type RunLaunchManifest, type RunOutcome } from "./run-artifacts"
import { createTestClock, waitForFilesystemState } from "./supervisor-test-signals"

const WAIT_MS = 30_000
const moduleDir = dirname(fileURLToPath(import.meta.url))

export async function slotHarness() {
  const root = await mkdtemp(join(tmpdir(), "reflection-slots-"))
  const locks = join(root, "runtime", "locks")
  const tickets = join(locks, "reflection-run.tickets")
  await mkdir(tickets, { recursive: true })
  const sockets = new Map<string, Socket>()
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

  function launch(run: Awaited<ReturnType<typeof makeRun>>) {
    const child = spawn(process.execPath, [join(moduleDir, "memory-run-supervisor.ts"), run.runDir], {
      env: { ...process.env, OMO_MEMORY_HOME: root, ...(run.clockPath === undefined ? {} : {
        OMO_MEMORY_SUPERVISOR_ALLOW_TEST_SEAMS: "1",
        OMO_MEMORY_SUPERVISOR_CLOCK_PATH: run.clockPath,
      }) },
      stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
    })
    processes.push(child)
    let stderr = ""
    child.stderr?.on("data", (chunk) => { stderr += String(chunk) })
    const exit = new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`supervisor ${run.id} exit timeout: ${stderr}`)), WAIT_MS)
      child.once("error", (error) => { clearTimeout(timeout); reject(error) })
      child.once("close", (code) => {
        clearTimeout(timeout)
        if (stderr.includes("Unhandled")) reject(new Error(stderr))
        else resolve(code)
      })
    })
    exits.push(exit)
    return { child, exit }
  }

  const wait = <T>(probe: () => T | undefined | Promise<T | undefined>, description: string) =>
    waitForFilesystemState(tickets, probe, WAIT_MS, description)
  return {
    root, locks, tickets, sockets, order, makeRun, launch,
    peak: () => peak,
    waitStarted: (id: string) => wait(() => sockets.has(id) ? true : undefined, `child ${id} started`),
    waitAccounted: (count: number, minimumStarted = 1) => wait(async () =>
      sockets.size >= minimumStarted
      && sockets.size + (await readdir(tickets)).filter((name) => name.endsWith(".ticket")).length === count
        ? true : undefined, `${count} running or queued supervisors`),
    waitQueued: (count: number) => wait(async () =>
      (await readdir(tickets)).filter((name) => name.endsWith(".ticket")).length === count
        ? true : undefined, `${count} queued supervisors`),
    release: (id: string) => {
      const socket = sockets.get(id)
      if (socket === undefined) throw new Error(`child ${id} did not start`)
      socket.end()
    },
    flow: () => { flowing = true; for (const socket of sockets.values()) socket.end() },
    outcome: async (runDir: string) => {
      await waitForFilesystemState(runDir, () => existsSync(join(runDir, "outcome.json")) ? true : undefined, WAIT_MS, "outcome")
      return readRunJson<RunOutcome>(join(runDir, "outcome.json"))
    },
    cleanup: async () => {
      for (const socket of sockets.values()) socket.end()
      for (const child of processes) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
      await Promise.allSettled(exits)
      for (const socket of sockets.values()) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    },
  }
}
