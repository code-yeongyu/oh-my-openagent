import { AsyncResource } from "node:async_hooks"
import { isAbsolute } from "node:path"

import {
  loadOmoConfig,
  resolveSessionWakeSettings,
  type OmoSessionWakeSettings,
  type ResolvedSessionWakeSettings,
} from "@oh-my-opencode/omo-config-core"
import { OMO_SENPI_TASK_RPC_CHILD } from "@oh-my-opencode/senpi-task/rpc-spawn"

import { resolveAgentHome } from "../../agent-home/resolve-agent-home"
import { isCi } from "../../device-service/registrant-start"
import type { DeliveryServicePort } from "../consumer/port"
import type { IntakeAdmission } from "../gateway/intake-admission"
import { createSameDeviceWake, type SameDeviceWake } from "../gateway/same-device-wake"
import { createGatewayStore, type GatewayStore } from "../gateway/store"
import { resolveThreadSocket } from "../live-surface-paths"
import { createCarrier, type Carrier, type CarrierEvaluation, type CarrierWakeOutcome } from "./carrier"
import { connectCarrierHost, type CarrierHostConnection } from "./carrier-connection"
import { startDeliveryConsumer, type ServingConsumer } from "./consumer-start"
import { engineDropsRetainedRecord } from "./engine-minimum"

type Env = Readonly<Record<string, string | undefined>>

export type WakeConfigView = { readonly session_wake?: OmoSessionWakeSettings | undefined }

/** Every field is a seam; production passes none of them. */
export type ThreadWakeOptions = {
  readonly env?: Env
  readonly latch?: ThreadWakeLatch
  /** The store the carrier and the consumer share; absent, the running wake opens its own under the agent dir. */
  readonly store?: GatewayStore
  readonly connect?: () => Promise<CarrierHostConnection>
  readonly loadConfig?: (options: { readonly cwd: string }) => { readonly config: WakeConfigView }
  /**
   * The device service's delivery protocol (`deliveries.serve`, design 5.4). The device service's local API v1 does
   * not carry it yet (it is in no relay-spec fixture), so production has no port and serves no consumer.
   */
  readonly deliveries?: () => Promise<DeliveryServicePort | undefined>
  readonly engineVersion?: string
  readonly minimumEngine?: string | null
  readonly schedule?: (run: () => void, ms: number) => () => void
  readonly onWake?: (durableId: string, outcome: CarrierWakeOutcome) => void
}

export type RunningThreadWake = {
  readonly carrier: Carrier
  readonly wake: (durableId: string) => Promise<void>
  /** Asked by a woken session's drain about a row from another device; `unknown` while no consumer serves. */
  readonly admitIntake: (device: string) => Promise<IntakeAdmission>
  /** Settles once the consumer has declared itself, or decided it serves nothing. */
  readonly ready: Promise<void>
  readonly stop: () => Promise<void>
}

export type ThreadWakeLatch = { running?: Map<string, RunningThreadWake> }

const LATCH_KEY = Symbol.for("omo.thread.wake.carrier")

function processLatch(): ThreadWakeLatch {
  const existing: unknown = Reflect.get(globalThis, LATCH_KEY)
  if (typeof existing === "object" && existing !== null) return existing as ThreadWakeLatch
  const latch: ThreadWakeLatch = {}
  Reflect.set(globalThis, LATCH_KEY, latch)
  return latch
}

// Captured while senpi imports omo.js, so no session's handle ledger owns the carrier's sockets and timers (as the
// device-service registrant does).
const processScope = new AsyncResource("omo-thread-wake-carrier")

const unrefSchedule = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms)
  timer.unref?.()
  return () => clearTimeout(timer)
}

/** A carry that ended: the session is no longer this carrier's, so its intake marks may now be drained. */
const ENDED: ReadonlySet<CarrierEvaluation["kind"]> = new Set(["released", "handed_over", "closed_waiting", "held"])

/**
 * `session_wake` as the machine's omo configuration says it now, read at each send and each open. The `same_device`
 * switch is read for the TARGET session's cwd (its project's configuration); every other read (such as `wake_limit`)
 * falls back to the caller's workspace root, the first registering session's.
 */
export function wakeSettingsReader(
  options: ThreadWakeOptions,
  cwd: () => string,
  warn: (line: string) => void,
): (cwd?: string) => ResolvedSessionWakeSettings {
  const env = options.env ?? process.env
  const load = options.loadConfig ?? ((input) => loadOmoConfig({ cwd: input.cwd, env, harness: "senpi" }))
  return (at?: string) => {
    try {
      return resolveSessionWakeSettings(load({ cwd: at ?? cwd() }).config)
    } catch (error) {
      warn(`thread wake: the session_wake settings were not read: ${error instanceof Error ? error.message : String(error)}`)
      return resolveSessionWakeSettings({})
    }
  }
}

/** The local transport's same-device wake: the process's running carrier takes the wake when there is one. */
export function processSameDeviceWake(input: {
  readonly options: ThreadWakeOptions
  readonly store: GatewayStore
  readonly agentDir: () => string
  readonly sessionsDirectory: () => string
  readonly settings: (cwd?: string) => ResolvedSessionWakeSettings
}): SameDeviceWake {
  const latch = input.options.latch ?? processLatch()
  return {
    afterSend: async (result) => {
      const running = latch.running?.get(input.agentDir())
      return await createSameDeviceWake({
        store: input.store,
        sessionsDirectory: input.sessionsDirectory(),
        enabled: (cwd) => input.settings(cwd).sameDevice,
        ...(running === undefined ? {} : { carrier: { wake: running.wake } }),
      }).afterSend(result)
    },
  }
}

/** The receiving drain's admission check (5.6), answered by this process's serving consumer. */
export function processIntakeAdmission(
  options: ThreadWakeOptions,
  agentDir: () => string,
): (device: string) => Promise<IntakeAdmission> {
  const latch = options.latch ?? processLatch()
  return async (device) => (await latch.running?.get(agentDir())?.admitIntake(device)) ?? "unknown"
}

export type ThreadWakeStart = {
  readonly options: ThreadWakeOptions
  readonly agentDir: () => string
  readonly sessionsDirectory: () => string
  readonly settings: (cwd?: string) => ResolvedSessionWakeSettings
  readonly engineVersion: string | undefined
  readonly ensureHost: (() => Promise<void>) | undefined
  readonly warn: (line: string) => void
}

/**
 * Starts the process's carrier (#13037 A3.1.3) for this agent directory on the first `session_start` of a `tui` or `rpc`
 * engine, never in a task child or under CI, and at most once per process: the operator host it opens woken sessions on
 * is the one `thread_create` opens on (`resolveThreadSocket`). The delivery consumer starts beside it (`consumer-start.ts`).
 * The same engine minimum the consumer reads (A8.1) gates the whole wake: below it no carrier starts, so a send to a
 * session that is not running answers as it did before the wake existed (`queued_offline`, reason `wake_unavailable`).
 */
export function startThreadWakeAtSession(eventCtx: unknown, input: ThreadWakeStart): void {
  const mode = (eventCtx as { readonly mode?: unknown } | null | undefined)?.mode
  if (mode !== "tui" && mode !== "rpc") return
  const env = input.options.env ?? process.env
  if (isCi(env) || env[OMO_SENPI_TASK_RPC_CHILD] === "1") return
  const agentDir = input.agentDir()
  if (!isAbsolute(agentDir)) return
  if (!engineDropsRetainedRecord(input.options.engineVersion ?? input.engineVersion, input.options.minimumEngine))
    return
  const latch = input.options.latch ?? processLatch()
  const running = (latch.running ??= new Map())
  if (running.has(agentDir)) return
  running.set(
    agentDir,
    processScope.runInAsyncScope(() => startRunning(agentDir, env, input)),
  )
}

function startRunning(agentDir: string, env: Env, input: ThreadWakeStart): RunningThreadWake {
  const { options } = input
  const store = options.store ?? createGatewayStore({ agentDir })
  const sessionsDirectory = input.sessionsDirectory()
  let serving: ServingConsumer | undefined
  const carrier = createCarrier({
    store,
    sessionsDirectory,
    ensureHost: input.ensureHost ?? (async () => undefined),
    connect:
      options.connect ??
      (() =>
        connectCarrierHost({
          socket: resolveThreadSocket(env),
          keyRoot: () => env.SENPI_RPC_KEY_ROOT?.trim() || resolveAgentHome({ env }),
          background: true,
        })),
    wakeLimit: () => input.settings().wakeLimit,
    sameDevice: (cwd) => input.settings(cwd).sameDevice,
    remoteWake: () => serving?.consumer.wakeAllowed() ?? false,
    schedule: options.schedule ?? unrefSchedule,
    onEvent: (event) => {
      if (ENDED.has(event.outcome.kind))
        void serving?.consumer.reportDrained().catch((error: unknown) => input.warn(`thread wake: drained marks not reported: ${String(error)}`))
    },
  })
  const wake = async (durableId: string): Promise<void> => {
    const outcome = await carrier.wake(durableId)
    if (outcome.kind === "failed") input.warn(`thread wake: ${durableId} was not started after ${outcome.attempts} attempts`)
    options.onWake?.(durableId, outcome)
  }
  const ready = startDeliveryConsumer({
    store,
    agentDir,
    sessionsDirectory,
    deliveries: options.deliveries,
    engineVersion: options.engineVersion ?? input.engineVersion,
    minimumEngine: options.minimumEngine,
    wake,
    sameDevice: (cwd) => input.settings(cwd).sameDevice,
    log: input.warn,
  }).then(
    (started) => {
      serving = started
    },
    (error: unknown) => input.warn(`thread wake: the delivery consumer did not start: ${String(error)}`),
  )
  return {
    carrier,
    wake,
    admitIntake: async (device) => {
      await ready
      return serving === undefined ? "unknown" : await serving.admitIntake(device)
    },
    ready,
    stop: async () => {
      await ready
      serving?.consumer.stop()
      await carrier.stop()
      if (options.store === undefined) await store.dispose().catch(() => undefined)
    },
  }
}
