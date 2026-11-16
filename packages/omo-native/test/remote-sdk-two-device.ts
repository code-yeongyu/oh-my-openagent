import { openRemote, type DeviceRow, type RemoteFailure } from "omo-ai/remote"

// omo#13413's acceptance script: open, send, read, watch and close one session on EACH of two devices through the
// importable SDK, timing every op. Usage: bun packages/omo-native/test/remote-sdk-two-device.ts <deviceA> <deviceB> [workspace]

type Outcome<T> = { readonly kind: "ok"; readonly value: T } | RemoteFailure

const [deviceA, deviceB, workspace] = process.argv.slice(2)
if (deviceA === undefined || deviceB === undefined) {
  console.error("usage: bun packages/omo-native/test/remote-sdk-two-device.ts <deviceA> <deviceB> [workspace]")
  process.exit(2)
}

const remote = openRemote()
const rows: { device: string; op: string; ms: number; ok: boolean; detail: string }[] = []

const timed = async <T>(device: string, op: string, call: () => Promise<Outcome<T>>): Promise<T> => {
  const started = performance.now()
  const outcome = await call()
  const ms = Math.round(performance.now() - started)
  const detail = outcome.kind === "ok" ? "" : `${outcome.code}: ${outcome.message}`
  rows.push({ device, op, ms, ok: outcome.kind === "ok", detail })
  if (outcome.kind !== "ok") throw new Error(`${device} ${op} failed: ${detail}`)
  return outcome.value
}

const roundTrip = async (target: DeviceRow): Promise<void> => {
  const marker = `rt-sdk-${target.name}-${Date.now()}`
  const opened = await timed(target.name, "open", () =>
    remote.sessions.open({ device: target.id, ...(workspace === undefined ? {} : { workspace }), name: marker }),
  )
  const events = remote.sessions.follow(opened.thread)
  await timed(target.name, "send", () => remote.sessions.send(opened.thread, { text: `Reply with exactly: ${marker}` }))
  const started = performance.now()
  for await (const event of events) {
    if (event.kind === "failed") throw new Error(`${target.name} watch failed: ${event.failure.code}`)
    if (event.kind === "end") break
  }
  events.stop()
  rows.push({
    device: target.name,
    op: "watch-to-turn-end",
    ms: Math.round(performance.now() - started),
    ok: true,
    detail: "",
  })
  const page = await timed(target.name, "read", () => remote.sessions.read(opened.thread, { tail: 20 }))
  if (!JSON.stringify(page).includes(marker)) throw new Error(`${target.name} read does not carry the sent message ${marker}`)
  await timed(target.name, "close", () => remote.sessions.close(opened.thread))
}

try {
  const devices = await timed("-", "devices.list", () => remote.devices.list())
  const targets = [deviceA, deviceB].map((wanted) => {
    const row = devices.find((device) => device.id === wanted || device.name === wanted)
    if (row === undefined) throw new Error(`device ${wanted} is not on this account`)
    return row
  })
  await timed("-", "sessions.list", () => remote.sessions.list({ all_scope: true }))
  await Promise.all(targets.map(roundTrip))
  console.log(JSON.stringify({ result: "PASS", rows }, null, 2))
} catch (error) {
  console.log(JSON.stringify({ result: "FAIL", error: String(error), rows }, null, 2))
  process.exitCode = 1
} finally {
  remote.close()
}
