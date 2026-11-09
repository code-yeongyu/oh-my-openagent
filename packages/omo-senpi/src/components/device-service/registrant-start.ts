import { isAbsolute } from "node:path"

import { type AgentDirRegistrant, deviceServiceStateDir, startAgentDirRegistrant } from "@oh-my-opencode/device-service-core"
import { isOmoDeviceServiceEnabled, type OmoDeviceServiceConfigView } from "@oh-my-opencode/omo-config-core"
import { OMO_SENPI_TASK_RPC_CHILD } from "@oh-my-opencode/senpi-task/rpc-spawn"

import type { ComponentLogger } from "../../extension/types"
import { createOmoNativeProductConfig } from "../telemetry/product-identity"

// The agent dir registrant's start (#12379): one per engine process for every tui or rpc engine, except task
// children, CI and `device_service.enabled: false`. It registers the agent dir the engine itself resolved, and it is
// started inside the extension's process-level scope so no session's teardown closes it.

export interface RegistrantLatch {
  claimed: boolean
  registrant?: AgentDirRegistrant
}

/** The process-level scope the registrant runs in; `AsyncResource` captured at omo.js's module top level. */
export interface ProcessScope {
  runInAsyncScope<T>(fn: () => T): T
}

export type StartRegistrant = (input: { readonly agentDir: string }) => AgentDirRegistrant | undefined

export interface RegistrantStartOptions {
  /** The default lives on globalThis and holds the registrant, so every copy of the sidecar shares one per process. */
  readonly registrantLatch?: RegistrantLatch
  readonly startRegistrant?: StartRegistrant
  readonly scope?: ProcessScope
}

const LATCH_KEY = Symbol.for("omo.device-service.registrant")

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isLatch = (value: unknown): value is RegistrantLatch => isRecord(value) && typeof value.claimed === "boolean"

function processRegistrantLatch(): RegistrantLatch {
  const existing: unknown = Reflect.get(globalThis, LATCH_KEY)
  if (isLatch(existing)) return existing
  const latch: RegistrantLatch = { claimed: false }
  Reflect.set(globalThis, LATCH_KEY, latch)
  return latch
}

export const isCi = (env: Readonly<Record<string, string | undefined>>): boolean => {
  const ci = env.CI?.trim().toLowerCase()
  return ci !== undefined && ci !== "" && ci !== "0" && ci !== "false"
}

const startDefault = (logger: ComponentLogger): StartRegistrant => ({ agentDir }) =>
  startAgentDirRegistrant({
    agentDir,
    stateDir: deviceServiceStateDir(),
    version: createOmoNativeProductConfig().packageVersion,
    onEvent: event => {
      if (event.kind === "register_failed") logger.warn("device service did not take this engine's agent dir", { reason: event.reason })
    },
  })

const unscoped: ProcessScope = { runInAsyncScope: fn => fn() }

export function startRegistrantAtStart(
  eventCtx: unknown,
  logger: ComponentLogger,
  options: RegistrantStartOptions & {
    readonly env: Readonly<Record<string, string | undefined>>
    readonly loadConfig: (options: { readonly cwd: string }) => { readonly config: OmoDeviceServiceConfigView }
  },
): void {
  if (!isRecord(eventCtx) || (eventCtx.mode !== "tui" && eventCtx.mode !== "rpc")) return
  const agentDir = eventCtx.agentDir
  if (typeof agentDir !== "string" || !isAbsolute(agentDir)) return
  if (isCi(options.env) || options.env[OMO_SENPI_TASK_RPC_CHILD] === "1") return
  const latch = options.registrantLatch ?? processRegistrantLatch()
  if (latch.claimed) return
  const cwd = typeof eventCtx.cwd === "string" ? eventCtx.cwd : process.cwd()
  if (!isOmoDeviceServiceEnabled(options.loadConfig({ cwd }).config)) return
  latch.claimed = true
  const start = options.startRegistrant ?? startDefault(logger)
  const registrant = (options.scope ?? unscoped).runInAsyncScope(() => start({ agentDir }))
  if (registrant !== undefined) latch.registrant = registrant
}
