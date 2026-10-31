// Loaded by the REAL senpi engine (`senpi --mode rpc -e <this file>`): registers only the production memory
// component, so its startup claims the inherited memory-sync channel exactly as the shipped extension does.
import type { SenpiExtensionAPI } from "../../extension/types"
import type { HostMemorySync } from "./desktop-sync/hostSelection"
import { createMemoryComponent } from "./index"
import { componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"

const HOST_KEY = Symbol.for("omo.memory-sync.host-selection.v10")

export default function memoryEngineFixture(pi: SenpiExtensionAPI): void {
  createMemoryComponent({
    loadConfig: () => loadedMemoryConfig(memorySettings()),
    sweepTransientRuns: async () => ({ removedRuns: 0, removedIdentities: 0, promoted: 0, stranded: 0, kept: 0 }),
  }).register(pi, componentContext())
  pi.rpc?.handle?.("fixture.memory-sync.selection", async () => {
    const host: HostMemorySync | undefined = Reflect.get(globalThis, HOST_KEY)
    if (host === undefined) return { kind: "absent" }
    const selection = await host.selection
    return selection.kind === "unavailable" ? { kind: selection.kind, reason: selection.reason } : { kind: selection.kind }
  })
}
