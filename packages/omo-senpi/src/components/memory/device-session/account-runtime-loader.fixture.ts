// The fallback path of omo.js's registration half (#12057): no host CLI captured senpi's private-descriptor table, so
// the launch's SENPI_PRIVATE_FDS is still in this process's environment when the memory component registers. It
// registers through the real loader with the sidecar's real claim, then reports what the environment held when
// registration returned and after the claim, and what the selection became.
// Run by account-runtime-loader.test.ts with a memory-sync socket at fd 5.
import { claimInheritedDesktopSync } from "../desktop-sync/desktopClaim"
import type { MemorySyncSelection } from "../desktop-sync/hostSelection"
import { serveWorkerPort } from "../desktop-sync/workerPort"
import { selectedDeviceAccountSource } from "./account-runtime-loader"

const declaration = () => ({
  table: process.env.SENPI_PRIVATE_FDS ?? null,
  final: process.env.SENPI_PRIVATE_FDS_FINAL ?? null,
})

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
await source()
const afterClaim = declaration()
let reply: unknown = null
if (selected?.kind === "desktop") {
  reply = await selected.channel.request({ op: "descriptor" })
  selected.channel.close()
}
const selection = selected?.kind === "unavailable" ? `unavailable:${selected.reason}` : (selected?.kind ?? "none")
process.stdout.write(`${JSON.stringify({ atRegistration, afterClaim, selection, reply })}\n`, () => process.exit(0))
