import { monitorRpcOpen, remoteWakeUnavailable } from "../../../extension/senpi-seams"
import { toThreadAddressEntries } from "../address-book"
import type { ThreadToolFailure } from "../errors"
import { resolveMonitorTarget } from "../remote/lazy-ops"
import type { ExtensionToolHost } from "./extension-tools"
import { hostView, resolveAcross, sendAddressBook } from "./internals"
import type { ThreadToolSurfaceOptions } from "./ports"

/**
 * What `monitor({type: "rpc", target})` arms once the target is read as a thread address (#14294): the target as given,
 * the form senpi's watch takes (`<device id>/<session>` for another device, the thread id for this one), or a typed
 * refusal, so a target that names nothing never starts a watch that can only time out.
 */
export type MonitorTargetResolution =
  | { readonly kind: "keep" }
  | { readonly kind: "target"; readonly target: string }
  | { readonly kind: "refused"; readonly failure: ThreadToolFailure }

export type MonitorTargetResolver = (target: string, callerId: string) => Promise<MonitorTargetResolution>

/**
 * The monitor's target reading (`remote/monitor-source.ts` `resolveMonitorTarget`, in the thread client sidecar) over this
 * surface's address book and the account's listing, through the one resolver every thread tool uses (`resolveAcross`).
 */
export function createMonitorTargetResolver(options: ThreadToolSurfaceOptions): MonitorTargetResolver {
  return async (target, callerId) =>
    await resolveMonitorTarget(options.remote, target, async (address) => {
      await options.ensureHost?.()
      const view = await hostView(options, { offline: true })
      const entries = toThreadAddressEntries(sendAddressBook(options, view, address, true))
      return await resolveAcross(options, entries, address, callerId, true, "exact", true)
    })
}

/**
 * Reads every `monitor` call that arms an rpc watch through `resolve` before senpi runs it: a resolved target replaces the
 * call's own (senpi's `tool_call` input is mutable), a refusal blocks the call with `<code>: <message> <next action>`.
 * Other tools, other monitor sources and other actions are never read.
 */
export function installMonitorTargetResolution(
  pi: Required<Pick<ExtensionToolHost, "on">> & { readonly registerRpcRemoteSource?: unknown },
  resolve: MonitorTargetResolver,
  callerSessionId: () => string = () => "",
): void {
  pi.on("tool_call", async (payload, ctx) => {
    const call = monitorRpcOpen(payload)
    if (call === undefined) return undefined
    const caller =
      (ctx as { sessionManager?: { getSessionId?: () => string } } | undefined)?.sessionManager?.getSessionId?.() ??
      callerSessionId()
    const resolution = await resolve(call.target, caller)
    if (resolution.kind === "target") {
      // The remote-wake refusal ran on the target as given; a rewrite to <device>/<thread> is checked again.
      const unwakeable = remoteWakeUnavailable(pi, resolution.target)
      if (unwakeable !== undefined) return { block: true, reason: unwakeable.message }
      Reflect.set(call.input, "target", resolution.target)
    }
    if (resolution.kind !== "refused") return undefined
    const { code, message, next_action } = resolution.failure
    return { block: true, reason: `${code}: ${message} ${next_action}` }
  })
}
