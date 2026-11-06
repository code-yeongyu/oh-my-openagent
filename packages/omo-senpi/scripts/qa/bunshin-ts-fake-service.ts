// A stand-in for this device's device service at the local API v1 boundary, for the bunshin-ts eval SDK QA: a
// private state dir with a per-boot token, the real mutual-proof handshake, status.get, and the machine.* requests a
// relay transport sends, answered from a fixed two-device table. It speaks the protocol directly instead of reusing
// the vendored owner fake, whose request validator does not know machine.* yet. No network, no real service.
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  clientProof,
  mintId,
  mintNonce,
  posixSecureFile,
  proofMatches,
  serverProof,
  writeToken,
  type SecureFile,
} from "../../../device-service-core/src/local-api/access.ts"
import { encodeLine, LineDecoder, parseLine } from "../../../device-service-core/src/local-api/framing.ts"
import { listenLocal, type Transport } from "../../../device-service-core/src/local-api/transport.ts"

export type FakeDevice = Readonly<{
  device: string
  label: string
  os: string
  tags: readonly string[]
  // The service refuses this device's machine.describe, as it does once the device has not answered for 10 s.
  describeRefusal?: Readonly<{ code: string; reason: string }>
}>

export const FAKE_DEVICES: readonly FakeDevice[] = [
  { device: "fake-dev-builder", label: "builder", os: "linux", tags: ["builder"] },
  { device: "fake-dev-laptop", label: "laptop", os: "darwin", tags: ["desk"] },
]

const STATUS = {
  state: "connected",
  since_ms: 1_790_000_000_000,
  device: { id: "fake-dev-self", name: "QA device" },
  origin_configured: true,
  enabled: true,
} as const
const OPS = ["shell", "fs.stat"] as const
const OP_STATES = ["queued", "transport_confirmed", "host_dispatched", "host_applied"] as const

type Message = Readonly<Record<string, unknown>>
type Reply = { readonly ok: true; readonly data: Message; readonly after?: () => void } | { readonly ok: false; readonly code: string; readonly reason: string }
type OpRequest = Readonly<{ op_id: string; op: string; args?: Message }>
export type SentLine = Readonly<{ conn: number; message: Message }>

const isRecord = (value: unknown): value is Message => typeof value === "object" && value !== null && !Array.isArray(value)
const secure: SecureFile = process.platform === "win32" ? async () => {} : posixSecureFile

const describeDevice = (device: FakeDevice): Message => ({
  os: device.os,
  arch: "x64",
  tags: device.tags,
  ops: OPS,
  features: ["machine:v1"],
})

const execute = (device: FakeDevice, op: OpRequest): Message => {
  if (op.op === "shell") return { state: "applied", response: { exitCode: 0, stdout: `${device.label}: ${String(op.args?.["command"] ?? "")}`, stderr: "" } }
  if (op.op === "fs.stat") return { state: "applied", response: { path: String(op.args?.["path"] ?? ""), kind: "dir", size: 0 } }
  return { state: "refused", error: { code: "op_unknown", message: `${op.op} is not an op this device runs` } }
}

export async function startFakeDeviceService(options: { devices?: readonly FakeDevice[] } = {}) {
  const devices = options.devices ?? FAKE_DEVICES
  const stateDir = mkdtempSync(join(tmpdir(), "omo-bunshin-ts-fake-service-"))
  chmodSync(stateDir, 0o700)
  const token = await writeToken(stateDir, secure)
  const sent: SentLine[] = []
  const requests: Message[] = []
  const open = new Set<Transport>()
  let nextConn = 1
  let authenticated = 0

  const serve = (transport: Transport): void => {
    open.add(transport)
    const conn = nextConn++
    const send = (message: Message): void => {
      sent.push({ conn, message })
      transport.write(encodeLine(message))
    }
    const event = (kind: string, fields: Message): void => send({ type: "event", kind, ...fields })
    let serverNonce: string | undefined
    let proven = false

    const machine = (request: Message): Reply => {
      const device = devices.find((candidate) => candidate.device === request["device"])
      switch (request["type"]) {
        case "machine.list":
          return { ok: true, data: { machines: devices.map(({ device: id, label }) => ({ device: id, label, state: "online" })) } }
        case "machine.events.subscribe":
          return { ok: true, data: {}, after: () => devices.forEach((d) => event("machine.changed", { device: d.device, state: "online" })) }
        case "machine.describe":
          if (device === undefined) return { ok: false, code: "peer_not_found", reason: "no such device" }
          if (device.describeRefusal !== undefined) return { ok: false, ...device.describeRefusal }
          return { ok: true, data: { device: device.device, description: describeDevice(device) } }
        case "machine.batch": {
          if (device === undefined) return { ok: false, code: "peer_not_found", reason: "no such device" }
          const ops = Array.isArray(request["ops"]) ? (request["ops"] as OpRequest[]) : []
          return {
            ok: true,
            data: { batch_id: mintId() },
            after: () => {
              for (const op of ops) {
                for (const state of OP_STATES) event("machine.op_state", { op_id: op.op_id, state })
                event("machine.op_result", { op_id: op.op_id, response: execute(device, op) })
              }
            },
          }
        }
        case "machine.credit":
        case "machine.cancel":
          return { ok: true, data: {} }
        case "machine.result_of":
          return { ok: true, data: { state: "unknown" } }
        default:
          return { ok: false, code: "invalid_request", reason: `${String(request["type"])} is not served by the fake` }
      }
    }

    const reply = (id: string, outcome: Reply): void => {
      if (!outcome.ok) return send({ id, type: "response", ok: false, error: { code: outcome.code, reason: outcome.reason, action: null } })
      send({ id, type: "response", ok: true, data: outcome.data })
      outcome.after?.()
    }

    const onMessage = (message: unknown): void => {
      if (!isRecord(message)) return transport.destroy()
      if (serverNonce === undefined) {
        const nonce = message["client_nonce"]
        if (message["type"] !== "hello" || message["v"] !== 1 || typeof nonce !== "string") {
          send({ type: "refused", reason: "malformed" })
          return transport.close()
        }
        serverNonce = mintNonce()
        return send({
          type: "welcome",
          v: 1,
          service_version: "1.4.0",
          owner: "service",
          server_proof: serverProof(token, nonce, transport.endpoint),
          server_nonce: serverNonce,
          capabilities: [],
          state: STATUS,
        })
      }
      const id = message["id"]
      if (typeof id !== "string" || typeof message["type"] !== "string") return transport.destroy()
      requests.push(message)
      if (!proven) {
        if (message["type"] !== "authenticate") return reply(id, { ok: false, code: "unauthenticated", reason: "authenticate first" })
        const proof = message["client_proof"]
        if (typeof proof !== "string" || !proofMatches(clientProof(token, serverNonce, transport.endpoint), proof)) {
          reply(id, { ok: false, code: "client_proof_invalid", reason: "client proof does not verify" })
          return transport.close()
        }
        proven = true
        authenticated += 1
        return reply(id, { ok: true, data: {} })
      }
      if (message["type"] === "status.get") return reply(id, { ok: true, data: STATUS })
      reply(id, machine(message))
    }

    const decoder = new LineDecoder((line) => onMessage(parseLine(line)), () => transport.destroy())
    transport.onData((bytes) => decoder.push(bytes))
    transport.onClose(() => open.delete(transport))
  }

  const listener = await listenLocal(stateDir, serve, secure)
  return {
    stateDir,
    devices,
    sent,
    requests,
    authenticated: () => authenticated,
    openConnections: () => open.size,
    stop: async (): Promise<void> => {
      for (const transport of open) transport.destroy()
      await listener.close()
      rmSync(stateDir, { recursive: true, force: true })
    },
  }
}

export type FakeDeviceService = Awaited<ReturnType<typeof startFakeDeviceService>>
