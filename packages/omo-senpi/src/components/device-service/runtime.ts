// Sidecar entry of the device service start-up bootstrap (#12051), bundled as extensions/omo-device-service.js and
// imported through `#omo-device-service-runtime` after the first interactive paint (see ./index.ts), so omo.js carries
// only the registration. Everything that decides and runs the bootstrap lives here.

import { isAbsolute } from "node:path"

import { isOmoDeviceServiceEnabled, type OmoDeviceServiceConfigView } from "@oh-my-opencode/omo-config-core"
import { OMO_SENPI_TASK_RPC_CHILD } from "@oh-my-opencode/senpi-task/rpc-spawn"

import type { ComponentLogger } from "../../extension/types"
import { loadSenpiOmoConfig } from "../config-resolution"
import { type BootstrapReport, runBootstrapWorker } from "./runner"

export interface ProcessLatch {
  claimed: boolean
}

export interface DeviceServiceRuntimeOptions {
  /** Claimed by the first bootstrap; the default lives on globalThis, so any copy of this module in the process shares it. */
  readonly latch?: ProcessLatch
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly loadConfig?: (options: { readonly cwd: string }) => { readonly config: OmoDeviceServiceConfigView }
  readonly run?: (omoBin: string) => Promise<BootstrapReport | undefined>
}

type Notify = (message: string, type?: "info" | "warning" | "error") => void

const LATCH_KEY = Symbol.for("omo.device-service.bootstrap")

const isLatch = (value: unknown): value is ProcessLatch => isRecord(value) && typeof value.claimed === "boolean"

// One latch per process, keyed on globalThis: a second instance of this module (another plugin copy, a reload that
// re-imports the sidecar) must not bootstrap again.
function processLatch(): ProcessLatch {
  const existing: unknown = Reflect.get(globalThis, LATCH_KEY)
  if (isLatch(existing)) return existing
  const latch: ProcessLatch = { claimed: false }
  Reflect.set(globalThis, LATCH_KEY, latch)
  return latch
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isCi = (env: Readonly<Record<string, string | undefined>>): boolean => {
  const ci = env.CI?.trim().toLowerCase()
  return ci !== undefined && ci !== "" && ci !== "0" && ci !== "false"
}

// Stops that are not the user's to act on at start-up: signed out, or no credential store to tell whether anyone is
// signed in at all (a machine without a keyring must not warn on every start).
const QUIET_STOPS: ReadonlySet<string> = new Set(["signed_out", "store_unavailable"])

function notifierOf(eventCtx: unknown): Notify | undefined {
  if (!isRecord(eventCtx) || eventCtx.hasUI !== true || !isRecord(eventCtx.ui)) return undefined
  const ui = eventCtx.ui
  const notify: unknown = ui.notify
  return typeof notify === "function" ? (message, type) => Reflect.apply(notify, ui, [message, type]) : undefined
}

/**
 * The bootstrap of one interactive TUI start: only in an engine an omo launcher started (an absolute OMO_BIN), never
 * under CI or in a task child (team members included; they inherit OMO_BIN from the parent that already ran it), and
 * not with `device_service.enabled: false`; once per process. Speaks only for a stop the user can act on.
 */
export async function bootstrapAtStart(eventCtx: unknown, logger: ComponentLogger, options: DeviceServiceRuntimeOptions = {}): Promise<void> {
  const env = options.env ?? process.env
  const omoBin = env.OMO_BIN
  const notify = notifierOf(eventCtx)
  const latch = options.latch ?? processLatch()
  if (latch.claimed || omoBin === undefined || !isAbsolute(omoBin) || isCi(env) || env[OMO_SENPI_TASK_RPC_CHILD] === "1" || notify === undefined) return
  latch.claimed = true
  const cwd = isRecord(eventCtx) && typeof eventCtx.cwd === "string" ? eventCtx.cwd : process.cwd()
  if (!isOmoDeviceServiceEnabled((options.loadConfig ?? loadSenpiOmoConfig)({ cwd }).config)) return
  let report: BootstrapReport | undefined
  try {
    report = await (options.run ?? runBootstrapWorker)(omoBin)
  } catch (error) {
    logger.warn("device service bootstrap could not finish", { error: error instanceof Error ? error.message : String(error) })
    return
  }
  if (report === undefined) logger.warn("device service bootstrap answered no report")
  else if ("notice" in report && !QUIET_STOPS.has(report.state)) notify(report.notice, "warning")
}
