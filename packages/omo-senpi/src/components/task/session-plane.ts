import type { SenpiExtensionAPI } from "../../extension/types"

/**
 * Task tools run where the loop runs (split session, plan row O3), so every task handler is declared `runs: "brain"`
 * unless it names its side; a fused session registers each one as today.
 */
export function onLoopSide(pi: SenpiExtensionAPI): SenpiExtensionAPI {
  const on: SenpiExtensionAPI["on"] = (event, handler, options) => pi.on(event, handler, { ...options, runs: options?.runs ?? "brain" })
  return new Proxy(pi, { get: (target, property) => (property === "on" ? on : Reflect.get(target, property, target)) })
}
