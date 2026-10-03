import { createInterface } from "node:readline"

const capabilities = {
  backend: "fake", displayServer: null, capture: true, input: true, ax: true,
  backgroundWindowInput: true, deliveryModes: ["background", "foreground"],
  capturePermission: "granted", inputPermission: "granted", axPermission: "granted",
  displayCount: 1, focusGuard: true, stopPath: "global", stopReason: null,
  integrityLevel: null, screenLocked: false,
}
const status = {
  suspended: false, globalLive: true, hostRelayLive: true,
  heartbeatFresh: true, stopPath: "global", reason: null,
}
const send = (value) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...value })}\n`)
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method } = JSON.parse(line)
  send({ method: "engine.log", params: { level: "debug", message: method } })
  if (id === undefined) return
  if (method === "engine.hello") {
    return send({ id, result: { protocolVersion: "1", engineVersion: "test", buildSha: "test", abi: "senpi-desktop/1" } })
  }
  if (method === "session.open") return send({ id, result: { capabilities, resumeToken: "test-token" } })
  if (method === "capabilities") return send({ id, result: capabilities })
  if (method === "stopPath.start" || method === "stopPath.status") return send({ id, result: status })
  if (method !== "capture" && method !== "typeText") return send({ id, result: null })
  const permission = process.env.PERMISSION_TEST_PERMISSION ?? (method === "capture" ? "screen_recording" : "accessibility")
  const code = process.env.PERMISSION_TEST_ERROR ?? "PermissionDenied"
  return send({
    id,
    error: {
      code: -32000,
      message: "Denied by the test engine",
      data: {
        code,
        permission: {
          permission,
          app: "Test App",
          settingsUrl: "x-apple.systempreferences:com.apple.preference.security",
          relaunchRequired: true,
        },
      },
    },
  })
}).on("close", () => process.exit(0))
