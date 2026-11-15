// An extension a senpi SDK host loads the way the engine loads omo.js (#12057): its factory is the memory component's
// registration half through the real loader and the sidecar's real claim. It records what process.env held when
// registration returned and after the claim, and what the selection became. Driven by account-runtime-loader.host.fixture.ts.
import { claimInheritedDesktopSync } from "../desktop-sync/desktopClaim"
import type { MemorySyncSelection } from "../desktop-sync/hostSelection"
import { serveWorkerPort } from "../desktop-sync/workerPort"
import { selectedDeviceAccountSource } from "./account-runtime-loader"

export const ACCOUNT_RUNTIME_LOADER_REPORT = Symbol.for("omo.test.account-runtime-loader.report")

const declaration = () => ({
  table: process.env.SENPI_PRIVATE_FDS ?? null,
  final: process.env.SENPI_PRIVATE_FDS_FINAL ?? null,
})

export default function accountRuntimeLoaderFixture(): void {
  let selected: MemorySyncSelection | undefined
  const source = selectedDeviceAccountSource({ env: {} }, async () => ({
    claimInheritedDesktopSync,
    serveWorkerPort,
    selectedAccountSource: (selection) => async () => {
      selected = await selection()
      return null
    },
    workerMemorySyncSelection: () => Promise.reject(new Error("the main thread reads no Worker port")),
  }))
  const atRegistration = declaration()
  const report = source().then(async () => {
    const afterClaim = declaration()
    let reply: unknown = null
    if (selected?.kind === "desktop") {
      reply = await selected.channel.request({ op: "descriptor" })
      selected.channel.close()
    }
    const selection = selected?.kind === "unavailable" ? `unavailable:${selected.reason}` : (selected?.kind ?? "none")
    return { atRegistration, afterClaim, selection, reply }
  })
  Reflect.set(globalThis, ACCOUNT_RUNTIME_LOADER_REPORT, report)
}
