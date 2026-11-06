import { describe, expect, test } from "bun:test"
import { withContractHost, type ContractHost } from "../../../../senpi-task/src/runners/rpc-host/testing/contract-host"
import { createLiveThreadSurface, type LiveThreadSurface } from "./live-surface"

// The contract host enforces the engine's own close rules (senpi 2026.11.5-1): a close from a connection that holds no
// attachment is refused unknown_session, an attached close releases only the caller's hold, and unload_session with
// force drains every hold.
function surface(host: ContractHost): LiveThreadSurface {
  return createLiveThreadSurface(undefined, {
    env: { OMO_CODING_AGENT_DIR: host.root, SENPI_RPC_SOCKET: host.socket, SENPI_RPC_KEY_ROOT: host.root },
    statusAll: async () => undefined, registry: async () => [],
  })
}

async function close(host: ContractHost): Promise<unknown> {
  const client = surface(host)
  if (client.closeSession === undefined) throw new Error("closeSession is missing")
  return await client.closeSession("rpc-1", "dur-selected")
}

const sentTypes = (host: ContractHost) => host.frames.map(({ frame }) => frame.type).filter((type) => type !== "get_protocol_info" && type !== "authenticate")

describe("thread_close on this device's host: the session ends for every client that holds it", () => {
  test("#given a session another client also holds #when it is closed #then the host ends it for every holder and the close answers closed", async () => {
    await withContractHost({ auth: true, otherAttachments: 1 }, async (host) => {
      expect(await close(host)).toBe("closed")
      expect(host.live()).toBe(false)
      expect(host.mutations).toEqual([expect.objectContaining({ type: "unload_session", sessionId: "rpc-1", force: true, interrupt: true, children: "detach" })])
      expect(sentTypes(host).slice(0, 2)).toEqual(["attach_session", "unload_session"])
    })
  })

  test("#given a session with no file yet that only this client would hold #when it is closed #then an attached close_session ends it", async () => {
    await withContractHost({ auth: true, unwritten: true }, async (host) => {
      expect(await close(host)).toBe("closed")
      expect(host.live()).toBe(false)
      expect(host.mutations.map((frame) => frame.type)).toEqual(["close_session"])
    })
  })

  test("#given a session with no file yet that another client holds #when it is closed #then the answer says another client still holds it", async () => {
    await withContractHost({ auth: true, unwritten: true, otherAttachments: 1 }, async (host) => {
      expect(await close(host)).toBe("held_elsewhere")
      expect(host.live()).toBe(true)
    })
  })

  test("#given a session that already left the host #when it is closed #then nothing was live and nothing is mutated", async () => {
    await withContractHost({ auth: true, attachRefusal: "unknown_session" }, async (host) => {
      expect(await close(host)).toBe("not_live")
      expect(host.mutations).toEqual([])
    })
  })
})
