import { isAbsolute } from "node:path"

import { isOmoDeviceServiceEnabled, type OmoDeviceServiceConfigView } from "@oh-my-opencode/omo-config-core"

import { deferUntilAfterFirstPaint } from "../../extension/startup-deferral"
import type { ComponentLogger, OmoSenpiComponent } from "../../extension/types"
import { loadSenpiOmoConfig } from "../config-resolution"
import { type BootstrapReport, runBootstrapWorker } from "./runner"

// The device service bootstrap (#12051): every interactive omo start makes sure this device's OmO device service is
// installed, connected and holding the signed-in device, so the account's other devices can view and command its
// sessions (D1: same-account sign-in is the authorization, on by default). It runs once per process, after the first
// paint, in its own omo process, and speaks only when it stops on something the user can act on. Opt-outs:
// `device_service.enabled: false` (nothing runs) and `omo remote control off` (the service's attach setting, which the
// bootstrap never writes).

export interface ProcessLatch {
  claimed: boolean
}

export interface DeviceServiceComponentOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly loadConfig?: (options: { readonly cwd: string }) => { readonly config: OmoDeviceServiceConfigView }
  readonly run?: (omoBin: string) => Promise<BootstrapReport | undefined>
  readonly latch?: ProcessLatch
}

type NoticeSurface = { readonly cwd?: unknown; readonly ui: { readonly notify: (message: string, type?: "info" | "warning" | "error") => void } }

const PROCESS_LATCH = Symbol.for("omo.device-service.bootstrap")

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isLatch = (value: unknown): value is ProcessLatch => isRecord(value) && typeof value.claimed === "boolean"

// One latch per process, shared by every registration (a config reload registers the extension again).
function processLatch(): ProcessLatch {
  const existing: unknown = Reflect.get(globalThis, PROCESS_LATCH)
  if (isLatch(existing)) return existing
  const latch: ProcessLatch = { claimed: false }
  Reflect.set(globalThis, PROCESS_LATCH, latch)
  return latch
}

// Print runs, RPC hosts and task children have no UI: only an interactive start bootstraps.
function interactiveSurface(eventCtx: unknown): NoticeSurface | undefined {
  if (!isRecord(eventCtx) || eventCtx.hasUI !== true || !isRecord(eventCtx.ui)) return undefined
  const notify: unknown = eventCtx.ui.notify
  if (typeof notify !== "function") return undefined
  return { cwd: eventCtx.cwd, ui: { notify: (message, type) => Reflect.apply(notify, eventCtx.ui, [message, type]) } }
}

const isCi = (env: Readonly<Record<string, string | undefined>>): boolean => {
  const ci = env.CI?.trim().toLowerCase()
  return ci !== undefined && ci !== "" && ci !== "0" && ci !== "false"
}

function surfaceReport(report: BootstrapReport | undefined, surface: NoticeSurface, logger: ComponentLogger): void {
  if (report === undefined) {
    logger.warn("device service bootstrap answered no report")
    return
  }
  if (!("notice" in report) || report.state === "signed_out") return
  surface.ui.notify(report.notice, "warning")
}

export function createDeviceServiceComponent(options: DeviceServiceComponentOptions = {}): OmoSenpiComponent {
  return {
    name: "device-service",
    register(pi, ctx): void {
      const env = options.env ?? process.env
      const omoBin = env.OMO_BIN
      // Only an omo launcher sets OMO_BIN for its engine: a bare senpi, a test or a CI run has nothing to bootstrap.
      if (omoBin === undefined || !isAbsolute(omoBin) || isCi(env)) return
      const latch = options.latch ?? processLatch()
      const loadConfig = options.loadConfig ?? loadSenpiOmoConfig
      const run = options.run ?? runBootstrapWorker
      pi.on("session_start", (_payload, eventCtx) => {
        if (latch.claimed) return undefined
        const surface = interactiveSurface(eventCtx)
        if (surface === undefined) return undefined
        latch.claimed = true
        deferUntilAfterFirstPaint(ctx, "device service bootstrap", () => {
          const cwd = typeof surface.cwd === "string" ? surface.cwd : process.cwd()
          if (!isOmoDeviceServiceEnabled(loadConfig({ cwd }).config)) return undefined
          return run(omoBin).then(
            report => surfaceReport(report, surface, ctx.logger),
            (error: unknown) => ctx.logger.warn("device service bootstrap could not start", { error: error instanceof Error ? error.message : String(error) }),
          )
        })
        return undefined
      })
    },
  }
}
