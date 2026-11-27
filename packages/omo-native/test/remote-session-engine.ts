import { connectDeviceService } from "../../device-service-core/src/index.ts"
import type { CommandResult } from "../../device-service-core/src/remote-attach.ts"
import type { JsonObject } from "../../device-service-core/src/local-api/protocol.ts"
import { type FakeOwner, startFakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import type { World } from "../../device-service-core/test/local-api/conformance/world.ts"
import { pushRecords } from "../../omo-senpi/src/components/remote/attach.test-support"
import { owners, privateDir, run, SIGNED_IN, testBootstrap } from "./remote-cli-harness"
import { commandTargets, personWorld } from "./remote-person-world"

// `omo remote` over the conformance owner with the peer's engine answering per record type (#13414 4c-2): the owner
// answers every delegated command alike, so a test names the reply its engine gives one record (get_state while a turn
// runs, a prompt it queued) and the records the send's turn streams once the engine took the prompt.

export type Engine = {
  /** The reply's data by record type; `{ refuse }` answers that record the way an engine refuses it. */
  readonly replies?: Readonly<Record<string, JsonObject | { readonly refuse: string }>>
  /** The turn the prompt starts: each record is stamped with the prompt's clientMessageId, as the engine does. */
  readonly turn?: readonly JsonObject[]
  readonly world?: World
}

export async function onEngine(args: readonly string[], engine: Engine = {}) {
  let pushed = false
  const owner: FakeOwner = await startFakeOwner({
    stateDir: privateDir(),
    world: engine.world ?? personWorld(),
    onRequest: () => {
      const prompt = owner.state.commands.findLast((rpc) => rpc["type"] === "prompt")
      if (pushed || prompt === undefined || engine.turn === undefined) return
      pushed = true
      const id = prompt["clientMessageId"]
      pushRecords(
        owner,
        engine.turn.map((record) => (record["type"] === "agent_settled" ? record : { ...record, clientMessageId: id })),
      )
    },
  })
  owners.push(owner)
  const replies = engine.replies ?? {}
  const result = await run(args, owner.stateDir, SIGNED_IN, testBootstrap(), {
    connect: async () => {
      const svc = await connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir })
      const answer = async (rpc: JsonObject, answered: Promise<CommandResult>): Promise<CommandResult> => {
        const result = await answered
        const reply = replies[String(rpc["type"])]
        if (reply === undefined) return result
        return {
          ...result,
          response:
            "refuse" in reply
              ? { type: "response", command: rpc["type"], success: false, error: reply.refuse }
              : { type: "response", command: rpc["type"], success: true, data: reply },
        }
      }
      return {
        ...svc,
        attach: async (device, sessionId) => {
          const attached = await svc.attach(device, sessionId)
          return { ...attached, command: (rpc, options) => answer(rpc, attached.command(rpc, options)) }
        },
        sessionCommand: (device, key, rpc, options) => answer(rpc, svc.sessionCommand(device, key, rpc, options)),
        endpointCommand: async (device, rpc, options) => {
          const result = await svc.endpointCommand(device, rpc, options)
          return { ...result, ...(await answer(rpc, Promise.resolve(result))) }
        },
      }
    },
  })
  const sent = (type: string): JsonObject[] => owner.state.commands.filter((rpc) => rpc["type"] === type)
  return { ...result, sent, targets: commandTargets(owner.state.bindings) }
}
