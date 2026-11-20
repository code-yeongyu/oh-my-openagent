// The relay leg of the relay parity sweep (#13478), run on the SECOND device of a signed-in pair: sends each record to
// the target device's engine through this device's service and the relay, the way `omo remote attach` forwards a
// record (session route: `session.command {attach, rpc, delegated}` on an attach of the fixture session) and the way a
// session-less record goes (endpoint route: `session.command {device, endpoint, rpc}`). Answers the driver
// (script/qa/rpc-relay-parity-drive.ts) over stdin/stdout.
//   bun script/qa/rpc-relay-parity-live.ts leg relay
import {
  type CommandResult,
  type CommandRpc,
  connectDeviceService,
  type DeviceService,
  type RemoteAttach,
} from "../../packages/device-service-core/src/index.ts"
import type { Answer } from "../rpc-relay-parity-compare"
import { type JsonRecord, serveLeg } from "./rpc-relay-parity-lines"

// A record the driver sent is one parsed JSON line, so an object from it holds only JSON values (a CommandRpc).
const isParsedRecord = (value: unknown): value is CommandRpc =>
  typeof value === "object" && value !== null && !Array.isArray(value)

let service: DeviceService | undefined
let attach: RemoteAttach | undefined
let device = ""

const answerOf = (result: CommandResult): Answer => {
  if (result.response !== undefined) return { kind: "reply", reply: result.response }
  const reason = Reflect.get(result.outcome, "reason")
  return { kind: "outcome", state: result.outcome.state, ...(typeof reason === "string" ? { reason } : {}) }
}

const refusalOf = (error: unknown): Answer => {
  const code = error instanceof Error ? Reflect.get(error, "code") : undefined
  return { kind: "refused", code: typeof code === "string" ? code : "error", message: String(error).slice(0, 300) }
}

/** Attaches to the target's relay fixture, found by its durable id; its listing key routes every session record. */
async function setup(request: JsonRecord): Promise<JsonRecord> {
  device = String(request["device"])
  service = await connectDeviceService({ version: "5.1.72" })
  const located = await service.locate(device, String(request["durableId"]))
  attach = await service.attach(device, located.key)
  await attach.snapshot
  return {
    context: { sessionId: located.key },
    aliases: { [located.key]: "<session>" },
    serviceVersion: service.serviceVersion,
  }
}

async function send(route: unknown, record: CommandRpc): Promise<Answer> {
  if (service === undefined || attach === undefined) throw new Error("send before setup")
  try {
    return answerOf(route === "session" ? await attach.command(record) : await service.endpointCommand(device, record))
  } catch (error) {
    return refusalOf(error)
  }
}

await serveLeg(async (request) => {
  switch (request["op"]) {
    case "setup":
      return await setup(request)
    case "send": {
      const record = request["record"]
      if (!isParsedRecord(record)) throw new Error("send without a record")
      return { answer: await send(request["route"], record) }
    }
    case "teardown":
      await attach?.detach().catch(() => {})
      service?.close()
      return {}
    default:
      throw new Error(`unknown op ${String(request["op"])}`)
  }
})
