import type { ChildProcess } from "node:child_process"
import { createServer, type Server, type Socket } from "node:net"

export const EXIT_WAIT_MS = 10_000

/** Each bounded wait runTeardown performs, in order. The hook budget is derived from this list, so a new wait added
 * here raises the budget, and a wait runTeardown performs without a row here fails the budget test. */
export const TEARDOWN_WAITS_MS = { childRun: EXIT_WAIT_MS, stop: EXIT_WAIT_MS, close: EXIT_WAIT_MS } as const
const TEARDOWN_MARGIN_MS = 5_000
export const TEARDOWN_HOOK_TIMEOUT_MS = Object.values(TEARDOWN_WAITS_MS).reduce((sum, ms) => sum + ms, 0) + TEARDOWN_MARGIN_MS

export interface StopOptions {
  readonly waitMs?: number
  readonly isAlive?: (pid: number) => boolean
  readonly kill?: (pid: number) => void
}

interface Announcement {
  open: boolean
  readonly closed: Promise<void>
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  return await Promise.race([promise.then(() => true), timedOut]).finally(() => clearTimeout(timer))
}

/**
 * Processes a test planted (detached, so it has no exit event for them) announce their pid over a TCP connection
 * they hold for their whole life. The connection's close is the process's exit, and a pid is only ever signalled
 * while its own connection is still open, so a recorded pid that exited and was reused is never touched (#11695).
 */
export class PlantedProcesses {
  private readonly announcements = new Map<number, Announcement>()
  private readonly waiters = new Map<number, () => void>()
  private readonly sockets = new Set<Socket>()
  private readonly server: Server

  private constructor(server: Server) {
    this.server = server
  }

  static async listen(): Promise<PlantedProcesses> {
    const planted = new PlantedProcesses(createServer((socket) => planted.accept(socket)))
    await new Promise<void>((resolve) => planted.server.listen(0, "127.0.0.1", resolve))
    return planted
  }

  get port(): number {
    const address = this.server.address()
    if (address === null || typeof address === "string") throw new Error("planted-process server has no port")
    return address.port
  }

  exited(pid: number): Promise<void> | undefined {
    return this.announcements.get(pid)?.closed
  }

  async announced(pids: readonly number[], waitMs = EXIT_WAIT_MS): Promise<boolean> {
    const pending = pids.map((pid) =>
      this.announcements.has(pid) ? Promise.resolve() : new Promise<void>((resolve) => this.waiters.set(pid, resolve)))
    return await settledWithin(Promise.all(pending), waitMs)
  }

  /**
   * Kills every recorded pid whose connection is still open and waits for each to close. A pid whose connection
   * already closed has exited and is left alone. A pid that never announced cannot be proven to be ours, so it is
   * never signalled; if it is still alive after the wait it is reported. Anything left fails by name.
   */
  async stop(pids: readonly number[], options: StopOptions = {}): Promise<void> {
    const waitMs = options.waitMs ?? EXIT_WAIT_MS
    const isAlive = options.isAlive ?? processAlive
    const kill = options.kill ?? ((pid: number) => process.kill(pid, "SIGKILL"))
    const killed = pids.flatMap((pid) => {
      const announcement = this.announcements.get(pid)
      if (announcement?.open !== true) return []
      kill(pid)
      return [{ pid, closed: announcement.closed }]
    })
    await settledWithin(Promise.all(killed.map((entry) => entry.closed)), waitMs)
    const leftovers = [
      ...killed.filter((entry) => this.announcements.get(entry.pid)?.open === true)
        .map((entry) => `pid ${entry.pid} did not exit within ${waitMs}ms after SIGKILL`),
      ...pids.filter((pid) => !this.announcements.has(pid) && isAlive(pid))
        .map((pid) => `pid ${pid} never announced itself and is still alive`),
    ]
    if (leftovers.length > 0) throw new Error(`planted processes were left behind (#11695):\n  ${leftovers.join("\n  ")}`)
  }

  /**
   * server.close() completes only once every connection has closed, and a planted process that survives SIGKILL
   * keeps its connection open; so every remaining connection is destroyed first and the close is bounded.
   */
  async close(waitMs = EXIT_WAIT_MS): Promise<void> {
    for (const socket of this.sockets) socket.destroy()
    const closed = new Promise<void>((resolve) => this.server.close(() => resolve()))
    if (!(await settledWithin(closed, waitMs))) {
      throw new Error(`the planted-process server did not close within ${waitMs}ms (#11695)`)
    }
  }

  private accept(socket: Socket): void {
    let text = ""
    let identified = false
    this.sockets.add(socket)
    socket.once("close", () => this.sockets.delete(socket))
    socket.setEncoding("utf8")
    socket.on("error", () => undefined)
    socket.on("data", (chunk: string) => {
      text += chunk
      if (identified || !text.includes("\n")) return
      identified = true
      const pid = Number.parseInt(text, 10)
      const announcement: Announcement = {
        open: true,
        closed: new Promise<void>((resolve) => socket.once("close", () => {
          announcement.open = false
          resolve()
        })),
      }
      this.announcements.set(pid, announcement)
      this.waiters.get(pid)?.()
    })
  }
}

export interface TeardownSteps {
  readonly stopChildRun: (waitMs: number) => Promise<void>
  readonly stop: (waitMs: number) => Promise<void>
  readonly close: (waitMs: number) => Promise<void>
}

/**
 * The teardown order: the child run, then the planted processes, then the server. Every step runs even after an
 * earlier one fails; the first failure is thrown and a later one is attached as its cause, never hiding it.
 */
export async function runTeardown(steps: TeardownSteps): Promise<void> {
  const failures: unknown[] = []
  const attempt = async (step: (waitMs: number) => Promise<void>, waitMs: number): Promise<void> => {
    try {
      await step(waitMs)
    } catch (error) {
      failures.push(error)
    }
  }
  await attempt(steps.stopChildRun, TEARDOWN_WAITS_MS.childRun)
  await attempt(steps.stop, TEARDOWN_WAITS_MS.stop)
  await attempt(steps.close, TEARDOWN_WAITS_MS.close)
  const [first, ...later] = failures
  if (first === undefined) return
  if (first instanceof Error && later.length > 0) first.cause = later.length === 1 ? later[0] : later
  throw first
}

export async function stopChildRun(child: ChildProcess | undefined, waitMs = EXIT_WAIT_MS): Promise<void> {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
  child.kill("SIGKILL")
  if (!(await settledWithin(exited, waitMs))) {
    throw new Error(`the child test run (pid ${child.pid}) did not exit within ${waitMs}ms after SIGKILL (#11695)`)
  }
}
