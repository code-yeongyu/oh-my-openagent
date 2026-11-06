import { AsyncResource } from "node:async_hooks"

import { deferUntilAfterFirstPaint } from "../../extension/startup-deferral"
import type { OmoSenpiComponent } from "../../extension/types"
import type { DeviceServiceRuntimeOptions } from "./runtime"

// The device service at engine start (#12051, #12379): every interactive omo start makes sure this device's OmO device
// service is installed, connected and holding the signed-in device (the TUI bootstrap), and every tui or rpc engine
// keeps its own agent dir registered with that service, so the account's other devices can view and command its
// sessions (D1: same-account sign-in is the authorization, on by default). Opt-outs: `device_service.enabled: false`
// (nothing runs) and `omo remote control off` (the service's attach setting, which nothing here writes).
// omo.js carries only this hook (bundle budget): every decision, the process latches, the worker and the registrant
// load from the sidecar (./runtime.ts) after the first paint. A sidecar that cannot load is logged by the deferral.

// The extension's process-level async scope, captured while senpi imports omo.js and before any session callback
// runs. The registrant runs inside it, so senpi's per-session handle ledger never owns (and never closes at that
// session's shutdown) its socket, watcher or retry timers. Captured HERE, not in the sidecar: a sidecar imported from
// a session_start handler inherits that session's ledger context at its own top level.
const processScope = new AsyncResource("omo-device-service-registrant")

export interface DeviceServiceComponentOptions extends DeviceServiceRuntimeOptions {
  readonly loadRuntime?: () => Promise<Pick<typeof import("./runtime"), "startAtSession">>
}

export function createDeviceServiceComponent(options: DeviceServiceComponentOptions = {}): OmoSenpiComponent {
  return {
    name: "device-service",
    register(pi, ctx): void {
      pi.on("session_start", (_payload, eventCtx) => {
        // senpi's run mode: the TUI and RPC engines (the desktop's) publish endpoints; print, json and app-server do not.
        const mode = Reflect.get(Object(eventCtx), "mode")
        if (mode !== "tui" && mode !== "rpc") return undefined
        deferUntilAfterFirstPaint(ctx, "device service start", () =>
          (options.loadRuntime ?? (() => import("#omo-device-service-runtime")))().then(runtime =>
            runtime.startAtSession(eventCtx, ctx.logger, { scope: processScope, ...options }),
          ))
        return undefined
      })
    },
  }
}
