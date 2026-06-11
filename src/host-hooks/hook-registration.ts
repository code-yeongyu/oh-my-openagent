import type { HostKind } from "../host-contract"
import { targetHookMappings, type TargetHookEventName } from "./event-map"
import { TargetHookDispatcher } from "./hook-dispatch"

export type TargetHookApi = {
  on(event: TargetHookEventName, handler: (payload: unknown, context: unknown) => unknown | Promise<unknown>): void
}

export function registerTargetHookEvents(
  host: Exclude<HostKind, "opencode">,
  api: TargetHookApi,
  dispatcher: TargetHookDispatcher,
): void {
  for (const mapping of targetHookMappings(host)) {
    if (mapping.targetEvent === "resources_discover") continue
    api.on(mapping.targetEvent, (payload, context) =>
      dispatcher.dispatch({
        tier: mapping.tier,
        name: mapping.targetEvent,
        payload,
        context,
      }),
    )
  }
}
