import { deferUntilAfterFirstPaint } from "../../extension/startup-deferral"
import type { OmoSenpiComponent } from "../../extension/types"
import type { DeviceServiceRuntimeOptions } from "./runtime"

// The device service bootstrap (#12051): every interactive omo start makes sure this device's OmO device service is
// installed, connected and holding the signed-in device, so the account's other devices can view and command its
// sessions (D1: same-account sign-in is the authorization, on by default). Opt-outs: `device_service.enabled: false`
// (nothing runs) and `omo remote control off` (the service's attach setting, which the bootstrap never writes).
// omo.js carries only this hook (bundle budget): every decision, the process latch and the worker load from the
// sidecar (./runtime.ts) after the first paint of a TUI session. A sidecar that cannot load is logged by the deferral.

export interface DeviceServiceComponentOptions extends DeviceServiceRuntimeOptions {
  readonly loadRuntime?: () => Promise<Pick<typeof import("./runtime"), "bootstrapAtStart">>
}

export function createDeviceServiceComponent(options: DeviceServiceComponentOptions = {}): OmoSenpiComponent {
  return {
    name: "device-service",
    register(pi, ctx): void {
      pi.on("session_start", (_payload, eventCtx) => {
        // senpi's run mode identifies a TUI session: RPC mode binds a real UI context too (hasUI is true there).
        if (Reflect.get(Object(eventCtx), "mode") !== "tui") return undefined
        deferUntilAfterFirstPaint(ctx, "device service bootstrap", () =>
          (options.loadRuntime ?? (() => import("#omo-device-service-runtime")))().then(runtime =>
            runtime.bootstrapAtStart(eventCtx, ctx.logger, options),
          ))
        return undefined
      })
    },
  }
}
