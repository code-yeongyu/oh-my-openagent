import { readdirSync, rmSync } from "node:fs"
import { sep } from "node:path"

export type ReloadHost = {
  readonly child: {
    readonly exitCode: number | null
    readonly signalCode: NodeJS.Signals | null
    kill(signal: NodeJS.Signals): boolean
  }
  readonly exited: Promise<void>
}

export type ReloadCleanup = {
  readonly root: string
  readonly shutdowns: ReadonlyArray<() => Promise<unknown>>
  readonly hosts: readonly ReloadHost[]
  readonly restore: () => void
  readonly exitTimeoutMs?: number
}

export function ownsHostSocket(launchArgs: readonly string[] | undefined, root: string): boolean {
  const index = launchArgs?.indexOf("--socket") ?? -1
  const socket = index >= 0 ? launchArgs?.[index + 1] : undefined
  return socket !== undefined && socket.startsWith(`${root}${sep}`)
}

function signalRunning(hosts: readonly ReloadHost[], signal: NodeJS.Signals): void {
  for (const { child } of hosts) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal)
  }
}

async function waitForExit(hosts: readonly ReloadHost[], timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.all(hosts.map(({ exited }) => exited)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("packaged reload task host did not exit")), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function cleanUpReloadRun(run: ReloadCleanup): Promise<void> {
  const errors: unknown[] = []
  let exited = false
  try {
    for (const shutdown of run.shutdowns) {
      try {
        await shutdown()
      } catch (error) {
        errors.push(error)
      }
    }
    signalRunning(run.hosts, "SIGTERM")
    const timeoutMs = run.exitTimeoutMs ?? 10_000
    try {
      await waitForExit(run.hosts, timeoutMs)
    } catch (error) {
      errors.push(error)
      signalRunning(run.hosts, "SIGKILL")
      await waitForExit(run.hosts, timeoutMs)
    }
    exited = true
    const leftovers = readdirSync(run.root).filter((name) => name.startsWith("senpi-rpc-host-internal-"))
    if (leftovers.length > 0) errors.push(new Error(`task host left ${leftovers.join(", ")} behind`))
  } catch (error) {
    errors.push(error)
  } finally {
    if (exited) rmSync(run.root, { recursive: true, force: true })
    run.restore()
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, "packaged reload cleanup failed")
}
