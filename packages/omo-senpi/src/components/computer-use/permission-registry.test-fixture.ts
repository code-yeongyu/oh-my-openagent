import { DesktopEngineRpcError, DesktopService } from "@oh-my-opencode/senpi-desktop-service"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { TrackedDesktopService } from "./engine-status"

const scenario = process.argv[2]
const root = crypto.randomUUID()
const key = Symbol.for("omo.computer.permissionLatches")
const events: Array<{ name: string; data: unknown }> = []
const native = new DesktopEngineRpcError("capture", {
  code: -32000,
  message: "Denied by the test engine",
  data: {
    code: "PermissionDenied",
    permission: {
      permission: "screen_recording", app: "Test App",
      settingsUrl: "x-apple.systempreferences:com.apple.preference.security",
      relaunchRequired: true,
    },
  },
})
const seeded = (() => {
  switch (scenario) {
    case "preseed": return new Map([[root, new Set(["screen_recording"])]])
    case "incompatible": return new Map([[root, []]])
    case "future": return Object.freeze({ version: 2, claim: () => false })
    case "unfrozen": return { version: 1, claim: () => false }
    case "throwing-claim": return Object.freeze({
      version: 1, claim() { throw new TypeError("Incompatible claim implementation") },
    })
    case "throwing-shape": return Object.freeze({
      get version() { throw new TypeError("Incompatible version accessor") },
      claim: () => false,
    })
    default: return undefined
  }
})()
if (seeded !== undefined) Object.defineProperty(globalThis, key, {
  value: seeded, writable: true, configurable: scenario === "preseed",
})

const originalCall = DesktopService.prototype.call
DesktopService.prototype.call = async () => { throw native }
const preserved: boolean[] = []
let deleted: boolean | undefined
try {
  const generation = async () => {
    const { wireComputerPermissionEvents } = await import(`./permission-events.ts?generation=${crypto.randomUUID()}`)
    const pi = Object.assign(new FakeExtensionAPI(), {
      appendEntry() { throw new Error("Test session journal is read-only") },
    })
    pi.rpc = { emit: (name, data) => { events.push({ name, data }) } }
    const report = wireComputerPermissionEvents(pi, {}, { info() {}, warn() {}, error() {} })
    await pi.dispatch("session_start", {}, {
      sessionManager: { getSessionId: () => root, getEntries: () => [] },
    })
    const service = new TrackedDesktopService({ onPermissionRequired: report })
    return {
      async deny() {
        try {
          await service.call("capture", {})
          preserved.push(false)
        } catch (error) {
          preserved.push(error === native)
        }
      },
      close: () => pi.dispatch("session_shutdown", { reason: "reload" }),
    }
  }
  const first = await generation()
  if (scenario === "call-property") {
    const facade: unknown = Object.getOwnPropertyDescriptor(globalThis, key)?.value
    if (typeof facade === "object" && facade !== null && "claim" in facade && typeof facade.claim === "function") {
      Object.defineProperty(facade.claim, "call", { value: () => false })
    }
  }
  await first.deny()
  if (scenario === "delete") deleted = Reflect.deleteProperty(globalThis, key)
  if (scenario === "delete" || scenario === "reload") {
    await first.close()
    const reloaded = await generation()
    await reloaded.deny()
    await reloaded.close()
  } else {
    await first.deny()
    await first.close()
  }
  console.log(JSON.stringify({ events, preserved, deleted, root }))
} catch (error) {
  console.log(JSON.stringify({ events, preserved, deleted, root, setupError: String(error) }))
} finally {
  DesktopService.prototype.call = originalCall
}
