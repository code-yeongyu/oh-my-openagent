import { connect, type CommandHandle } from "../../../vendor/bunshin-ts/index.js"
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

export async function execOnDevice(
  runner: () => Promise<DeviceCommandRunner>,
  request: DeviceExecRequest,
  signal: AbortSignal,
  now: () => number = Date.now,
): Promise<DeviceExecResult> {
  const startedAtMs = now()
  let handle: CommandHandle
  try {
    const machine = await runner()
    handle = await machine.spawn(request.command, request.cwd === undefined ? {} : { cwd: request.cwd })
  } catch (error) {
    throw new DeviceUnavailableError("bash", error)
  }
  let timedOut = false
  let aborted = false
  const kills: Promise<void>[] = []
  const kill = (): void => {
    if (kills.length === 0) kills.push(handle.kill())
  }
  const onAbort = (): void => {
    aborted = true
    kill()
  }
  if (signal.aborted) onAbort()
  else signal.addEventListener("abort", onAbort, { once: true })
  const timeoutMs = request.timeoutMs
  const timer =
    timeoutMs !== undefined && Number.isFinite(timeoutMs)
      ? setTimeout(() => {
          timedOut = true
          kill()
        }, timeoutMs)
      : undefined
  try {
    for await (const chunk of handle.output()) request.onOutput?.(Buffer.from(chunk), "stdout")
    if (timedOut || aborted) {
      await Promise.all(kills)
      return result(null, false)
    }
    const exit = await handle.wait()
    return result(exit.exitCode, exit.truncated)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    signal.removeEventListener("abort", onAbort)
  }

  function result(exitCode: number | null, truncated: boolean): DeviceExecResult {
    return {
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
    }
  }
}

/**
 * This device's command runner through its device service's local API. Connected once and reused; a failed connect is
 * not cached, so a later call retries once the service is back.
 */
export function localDeviceRunner(env: Readonly<Record<string, string | undefined>> = process.env): () => Promise<DeviceCommandRunner> {
  let pending: Promise<DeviceCommandRunner> | undefined
  return () => {
    pending ??= (async () => {
      const stateDir = env["OMO_DEVICE_SERVICE_STATE_DIR"]?.trim() || undefined
      const options = stateDir === undefined ? {} : { stateDir }
      const status = await relayStatus(options)
      const self = status.device?.id
      if (self === undefined) throw new Error(`the device service reports no device (state ${String(status.state)})`)
      const client = await connect({ transport: createRelayTransport(options) })
      return client.getMachine(self)
    })().catch((error: unknown) => {
      pending = undefined
      throw error
    })
    return pending
  }
}
