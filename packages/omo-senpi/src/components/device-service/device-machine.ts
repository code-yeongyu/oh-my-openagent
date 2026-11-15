import { connect, type BunshinClient, type CommandHandle } from "../../../vendor/bunshin-ts/index.js"
import { createRelayTransport, relayStatus } from "../../../vendor/bunshin-ts-relay/index.js"

// Tools through this device's own hands daemon (Q's order; design note tools-via-hands-daemon.md). A command runs as
// one exec_command on THIS device through the device service's local API (service.sock): the service runs a machine
// batch toward its own device in process (relay-daemon#1134), so no relay hop is involved.

/** The device a routed tool should run on cannot be reached; the tool fails instead of running on this process. */
export class DeviceUnavailableError extends Error {
  readonly code = "device_unavailable" as const
  readonly tool: string

  constructor(tool: string, cause?: unknown) {
    super(
      `${tool}: the session's device is unavailable, and OMO_TOOLS_VIA_DAEMON routes ${tool} there, so it does not run locally`,
      cause === undefined ? undefined : { cause },
    )
    this.name = "DeviceUnavailableError"
    this.tool = tool
  }
}

export type DeviceCommandRunner = Readonly<{
  spawn(command: string, options?: { cwd?: string }): Promise<CommandHandle>
}>

/** Where commands go: the connected runner, and a way to drop it when its connection proved dead. */
export type DeviceRunnerSource = Readonly<{
  runner(): Promise<DeviceCommandRunner>
  drop(): void
}>

export type DeviceExecRequest = Readonly<{
  command: string
  cwd?: string
  timeoutMs?: number
  onOutput?: (chunk: Buffer, stream: "stdout" | "stderr") => void
}>

// The fields of senpi's MachineOps ExecResult. Output is streamed through onOutput; the device reports one merged
// stream and no pid, so stdout/stderr stay empty here and pid is undefined.
export type DeviceExecResult = Readonly<{
  pid: undefined
  exitCode: number | null
  signal: null
  stdout: Uint8Array
  stderr: Uint8Array
  stdoutTruncated: boolean
  stderrTruncated: false
  timedOut: boolean
  aborted: boolean
  startedAtMs: number
  durationMs: number
  scopeToken: undefined
}>

const EMPTY = new Uint8Array(0)
const KILL_FAILED = Symbol("kill failed")

export async function execOnDevice(
  source: DeviceRunnerSource,
  request: DeviceExecRequest,
  signal: AbortSignal,
  now: () => number = Date.now,
): Promise<DeviceExecResult> {
  const startedAtMs = now()
  let timedOut = false
  let aborted = signal.aborted
  const result = (exitCode: number | null, truncated: boolean): DeviceExecResult => ({
    pid: undefined,
    exitCode,
    signal: null,
    stdout: EMPTY,
    stderr: EMPTY,
    stdoutTruncated: truncated,
    stderrTruncated: false,
    timedOut,
    aborted,
    startedAtMs,
    durationMs: now() - startedAtMs,
    scopeToken: undefined,
  })
  // Already aborted: nothing is started on the device.
  if (aborted) return result(null, false)
  let handle: CommandHandle
  try {
    const machine = await source.runner()
    handle = await machine.spawn(request.command, request.cwd === undefined ? {} : { cwd: request.cwd })
  } catch (error) {
    source.drop()
    throw new DeviceUnavailableError("bash", error)
  }
  let killSent = false
  let killError: unknown
  let signalKillFailed: (value: typeof KILL_FAILED) => void = () => {}
  const killFailed = new Promise<typeof KILL_FAILED>((resolve) => {
    signalKillFailed = resolve
  })
  // The kill's outcome is handled the moment it is sent: a failed kill ends the run at once instead of leaving the
  // stream polling a command that keeps running.
  const kill = (): void => {
    if (killSent) return
    killSent = true
    handle.kill().then(
      () => undefined,
      (error: unknown) => {
        killError = error
        signalKillFailed(KILL_FAILED)
      },
    )
  }
  const onAbort = (): void => {
    aborted = true
    kill()
  }
  signal.addEventListener("abort", onAbort, { once: true })
  const timeoutMs = request.timeoutMs
  const timer =
    timeoutMs !== undefined && Number.isFinite(timeoutMs)
      ? setTimeout(() => {
          timedOut = true
          kill()
        }, timeoutMs)
      : undefined
  const stream = handle.output()[Symbol.asyncIterator]()
  let endedNormally = false
  try {
    for (;;) {
      const next = await Promise.race([stream.next(), killFailed])
      if (next === KILL_FAILED) {
        source.drop()
        throw new DeviceUnavailableError("bash", killError)
      }
      if (next.done === true) break
      request.onOutput?.(Buffer.from(next.value), "stdout")
    }
    endedNormally = true
    if (timedOut || aborted) return result(null, false)
    const status = await handle.status()
    return result(status.exitCode ?? null, status.truncated)
  } catch (error) {
    if (!endedNormally && !killSent) {
      // The run left early (a throwing consumer, a lost stream): the command may still be running on the device.
      killSent = true
      try {
        await handle.kill()
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "the device command failed and could not be killed")
      }
    }
    throw error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    signal.removeEventListener("abort", onAbort)
  }
}

/**
 * This device's command runner through its device service's local API. Connected once and reused; dropped (and the
 * connection closed) when a call proves it dead, so the next call reconnects once the service is back.
 */
export function localDeviceRunner(env: Readonly<Record<string, string | undefined>> = process.env): DeviceRunnerSource {
  let pending: Promise<{ client: BunshinClient; machine: DeviceCommandRunner }> | undefined
  const nonEmpty = (value: string | undefined): string | undefined => value?.trim() || undefined
  const drop = (): void => {
    const stale = pending
    pending = undefined
    // Closing a connection that already died has nothing left to report; the drop itself is the recovery.
    void stale?.then(({ client }) => client.close()).catch(() => undefined)
  }
  const connectOnce = async () => {
    const stateDir = nonEmpty(env["OMO_DEVICE_SERVICE_STATE_DIR"])
    const sessionRef = nonEmpty(env["PI_SESSION_ID"])
    const status = await relayStatus(stateDir === undefined ? {} : { stateDir })
    const self = status.device?.id
    if (self === undefined) throw new Error(`the device service reports no device (state ${String(status.state)})`)
    const client = await connect({
      transport: createRelayTransport({
        ...(stateDir === undefined ? {} : { stateDir }),
        ...(sessionRef === undefined ? {} : { sessionRef }),
      }),
    })
    return { client, machine: await client.getMachine(self) }
  }
  return {
    runner: async () => {
      pending ??= connectOnce().catch((error: unknown) => {
        pending = undefined
        throw error
      })
      return (await pending).machine
    },
    drop,
  }
}
