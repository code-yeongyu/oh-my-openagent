import { existsSync } from "node:fs"
import { connectDeviceService, type DeviceService, deviceServiceEndpointPath } from "./device-service.ts"
import { type EndpointWatch, watchEndpointFile } from "./registrant-watch.ts"

// The engine's agent dir registrant (#12379): one long-lived local-API connection per engine process that tells the
// device service which agent dir to scan. It registers once per new (proven connection, device id) pair: right after
// each proof, and again whenever the status names a device it has not registered for on that connection. A
// signed-out status, a refused register and a transport error reset that, so the next device id registers again. A
// new connection comes from the endpoint file appearing (watched before the first existence check) or from the
// previous connection closing; nothing polls. The only timers are the bounded connect retries and the watch's one
// settle re-check after each arm (see registrant-watch.ts).

const REGISTRANT_RETRY_DELAYS_MS: readonly number[] = [250, 1_000, 4_000]

export type RegistrantEvent =
  | { readonly kind: "registered"; readonly deviceId: string | null }
  | { readonly kind: "register_failed"; readonly deviceId: string | null; readonly reason: string }
  | { readonly kind: "status"; readonly deviceId: string | null }
  | { readonly kind: "disconnected" }
  | { readonly kind: "connect_failed"; readonly reason: string }
  | { readonly kind: "gave_up" }

/** Runs `run` after `ms` and returns its cancel; the default timer never keeps the process alive. */
export type RegistrantSchedule = (run: () => void, ms: number) => () => void

export type AgentDirRegistrantOptions = {
  readonly version: string
  /** The agent dir the running engine resolved (the parent of the `rpc-host-daemon` dir it publishes into). */
  readonly agentDir: string
  readonly stateDir: string
  readonly onEvent?: (event: RegistrantEvent) => void
  readonly connect?: () => Promise<DeviceService>
  readonly schedule?: RegistrantSchedule
  readonly watchEndpoint?: EndpointWatch
  /** Test seam: runs once between arming the watch and the first existence check. */
  readonly startupGap?: () => Promise<void>
}

export type AgentDirRegistrant = { readonly stop: () => void }

const backgroundTimer: RegistrantSchedule = (run, ms) => {
  const timer = setTimeout(run, ms)
  timer.unref()
  return () => clearTimeout(timer)
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const NONE = Symbol("none registered")

function holdConnection(
  service: DeviceService,
  agentDir: string,
  emit: (event: RegistrantEvent) => void,
  isCurrent: () => boolean,
): void {
  let registeredFor: string | null | typeof NONE = NONE
  let wanted: string | null | typeof NONE = NONE
  let wantedRevision = 0
  let inFlight = false

  const pump = (): void => {
    if (inFlight || !isCurrent() || wanted === NONE || wanted === registeredFor) return
    const deviceId = wanted
    const revision = wantedRevision
    inFlight = true
    service.registerEndpoints(agentDir).then(
      () => {
        inFlight = false
        if (!isCurrent()) return
        registeredFor = deviceId
        emit({ kind: "registered", deviceId })
        pump()
      },
      (error: unknown) => {
        inFlight = false
        if (!isCurrent()) return
        registeredFor = NONE
        if (revision === wantedRevision) wanted = NONE
        emit({ kind: "register_failed", deviceId, reason: reasonOf(error) })
        pump()
      },
    )
  }
  const want = (deviceId: string | null): void => {
    wanted = deviceId
    wantedRevision += 1
    pump()
  }

  want(null)
  service
    .watchStatus(status => {
      const deviceId = status.device?.id ?? null
      emit({ kind: "status", deviceId })
      if (deviceId === null) registeredFor = NONE
      else want(deviceId)
    })
    .catch(() => {})
}

export function startAgentDirRegistrant(options: AgentDirRegistrantOptions): AgentDirRegistrant {
  const endpoint = deviceServiceEndpointPath(options.stateDir)
  const emit = options.onEvent ?? (() => {})
  const connect = options.connect ?? (() => connectDeviceService({ version: options.version, stateDir: options.stateDir, background: true }))
  const schedule = options.schedule ?? backgroundTimer
  let stopped = false
  let current: DeviceService | undefined
  let connecting = false
  let cancelRetry: (() => void) | undefined

  const attempt = (retry: number): void => {
    connecting = true
    connect().then(
      service => {
        connecting = false
        if (stopped) {
          service.close()
          return
        }
        current = service
        void service.closed.then(() => {
          if (current !== service) return
          current = undefined
          emit({ kind: "disconnected" })
          trigger()
        })
        holdConnection(service, options.agentDir, emit, () => current === service && !stopped)
      },
      (error: unknown) => {
        connecting = false
        if (stopped) return
        emit({ kind: "connect_failed", reason: reasonOf(error) })
        const delay = REGISTRANT_RETRY_DELAYS_MS[retry]
        if (delay === undefined || !existsSync(endpoint)) {
          emit({ kind: "gave_up" })
          return
        }
        cancelRetry = schedule(() => {
          cancelRetry = undefined
          if (!stopped && current === undefined && !connecting) attempt(retry + 1)
        }, delay)
      },
    )
  }

  function trigger(): void {
    if (stopped || current !== undefined || connecting || !existsSync(endpoint)) return
    cancelRetry?.()
    cancelRetry = undefined
    attempt(0)
  }

  const stopWatch = (options.watchEndpoint ?? watchEndpointFile)(endpoint, trigger)
  void (async () => {
    await options.startupGap?.()
    trigger()
  })()

  return {
    stop: () => {
      stopped = true
      stopWatch()
      cancelRetry?.()
      current?.close()
      current = undefined
    },
  }
}
