import { AsyncResource } from "node:async_hooks"
import { basename, dirname, isAbsolute, resolve } from "node:path"

import { deferUntilAfterFirstPaint } from "../../extension/startup-deferral"
import type { OmoSenpiComponent } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { hostSocketOf } from "../thread/gateway/registration"
import { isThreadSocket } from "../thread/live-surface-paths"
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

// senpi names the directory a host keeps its endpoint record in, `<agent dir>/rpc-host-daemon/<id>`, in the host's own
// environment. Its agent dir is the one the device service must scan to list the host's endpoint, whatever spelling the
// launcher's own agent-dir variable used.
const HOST_DAEMON_DIR_ENV = "SENPI_RPC_HOST_DAEMON_DIR"

/**
 * The agent dir holding the daemon's endpoint registry, normalized like resolveAgentHome so one dir is never
 * registered under two spellings; `unreadable` when the variable is set but names no such registry.
 */
function daemonAgentDir(env: Readonly<Record<string, string | undefined>>): string | "unreadable" | undefined {
  const daemonDir = env[HOST_DAEMON_DIR_ENV]?.trim()
  if (!daemonDir) return undefined
  if (!isAbsolute(daemonDir)) return "unreadable"
  const registry = dirname(resolve(daemonDir))
  return basename(registry) === "rpc-host-daemon" ? dirname(registry) : "unreadable"
}

export interface DeviceServiceComponentOptions extends DeviceServiceRuntimeOptions {
  readonly loadRuntime?: () => Promise<Pick<typeof import("./runtime"), "startAtSession">>
}

export function createDeviceServiceComponent(options: DeviceServiceComponentOptions = {}): OmoSenpiComponent {
  return {
    name: "device-service",
    register(pi, ctx): void {
      const loadRuntime = options.loadRuntime ?? (() => import("#omo-device-service-runtime"))
      // The operator daemon registers its agent dir as soon as it loads omo - a `warm` (`omo daemon run` sends one) or
      // its first open - so a daemon the device service cold-starts has an engine endpoint before any session runs and
      // can be handed the delivery it was started for (#13037 cold wake). Its later sessions find the latch claimed.
      const env = options.env ?? process.env
      const hostSocket = hostSocketOf(pi)
      if (hostSocket !== undefined && isThreadSocket(hostSocket, env)) {
        const fromRegistry = daemonAgentDir(env)
        if (fromRegistry === "unreadable")
          ctx.logger.warn(
            "device service: the daemon's endpoint registry dir is unreadable; registering the launcher's agent dir",
            {
              [HOST_DAEMON_DIR_ENV]: env[HOST_DAEMON_DIR_ENV],
            },
          )
        const atLoad = {
          mode: "rpc",
          agentDir:
            fromRegistry === undefined || fromRegistry === "unreadable" ? resolveAgentHome({ env }) : fromRegistry,
          cwd: pi.cwd ?? process.cwd(),
        }
        void loadRuntime()
          .then((runtime) => runtime.startAtSession(atLoad, ctx.logger, { scope: processScope, ...options }))
          .catch((error: unknown) =>
            ctx.logger.warn("device service runtime could not be loaded", {
              reason: error instanceof Error ? error.message : String(error),
            }),
          )
      }
      pi.on("session_start", (_payload, eventCtx) => {
        // senpi's run mode: the TUI and RPC engines (the desktop's) publish endpoints; print, json and app-server do not.
        const mode = Reflect.get(Object(eventCtx), "mode")
        if (mode !== "tui" && mode !== "rpc") return undefined
        deferUntilAfterFirstPaint(ctx, "device service start", () =>
          loadRuntime().then((runtime) =>
            runtime.startAtSession(eventCtx, ctx.logger, { scope: processScope, ...options }),
          ),
        )
        return undefined
      })
    },
  }
}
