import { describe, expect, test } from "bun:test"
import { withContractHost, type ContractHost } from "../../../../senpi-task/src/runners/rpc-host/testing/contract-host"
import { DIAL_SCENES } from "../../../../senpi-task/src/runners/rpc-host/testing/dial-refusals"
import { createLocalAttach } from "../remote/local-attach"
import { createLiveThreadSurface } from "./live-surface"
import { connectCarrierHost } from "./wake/carrier-connection"

function surface(host: ContractHost, socket: string) {
  return createLiveThreadSurface(undefined, {
    env: { OMO_CODING_AGENT_DIR: host.root, SENPI_RPC_SOCKET: socket, SENPI_RPC_KEY_ROOT: host.root },
    statusAll: async () => undefined,
    registry: async () => [],
  })
}

const refusalOf = (attempt: Promise<unknown>) =>
  attempt.then(
    (value) => value,
    (error: unknown) => error,
  )

// Every omo-senpi dial of an rpc host (thread request, thread watch, wake carrier, local attach) answers each key-root scene alike.
const CALL_SITES: Record<string, (host: ContractHost, socket: string) => Promise<unknown>> = {
  "thread request": (host, socket) =>
    refusalOf(Reflect.apply(surface(host, socket).setSessionName, undefined, ["rpc-1", "renamed", "dur-selected"])),
  "thread watch": async (host, socket) => {
    const client = surface(host, socket)
    if (client.watchSession === undefined) throw new Error("watchSession is missing")
    return await refusalOf(client.watchSession("rpc-1", { record: () => {} }, "dur-selected"))
  },
  "wake carrier": (host, socket) => refusalOf(connectCarrierHost({ socket, keyRoot: () => host.root })),
  "local attach": (host, socket) =>
    refusalOf(
      createLocalAttach({ socket, keyRoot: host.root })({
        device: "dev-self",
        session: "s",
        durableId: "dur-selected",
      }),
    ),
}

async function release(outcome: unknown): Promise<void> {
  if (typeof outcome !== "object" || outcome === null) return
  const watch = Reflect.get(outcome, "watch")
  if (typeof watch === "object" && watch !== null && typeof Reflect.get(watch, "stop") === "function")
    Reflect.apply(Reflect.get(watch, "stop"), watch, [])
  const close = Reflect.get(outcome, "close")
  if (typeof close === "function") await Reflect.apply(close, outcome, [])
}

describe.skipIf(process.platform === "win32")("an rpc host dial over the key records under the key root", () => {
  for (const [site, dial] of Object.entries(CALL_SITES))
    test.each(Object.entries(DIAL_SCENES))(
      `#given %s #when the ${site} dials #then it answers as every client does`,
      async (_name, scene) => {
        await withContractHost(scene.options, async (host) => {
          const file = scene.arrange(host)
          const dialed = scene.dialed?.(host) ?? host.socket
          const outcome = await dial(host, dialed)
          const types = host.frames.map(({ frame }) => frame.type)
          if (scene.refusal === "authenticated") {
            await release(outcome)
            expect(types.slice(0, 2)).toEqual(["get_protocol_info", "authenticate"])
            expect(String(outcome instanceof Error ? outcome.message : "")).not.toMatch(
              /unsafe_key_record|host_identity_unproven/,
            )
            return
          }
          expect(String(outcome instanceof Error ? outcome.message : JSON.stringify(outcome))).toContain(
            scene.refusal(host, file, dialed),
          )
          expect(types).toEqual(["get_protocol_info"])
        })
      },
    )
})
