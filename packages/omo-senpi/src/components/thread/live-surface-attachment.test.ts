import { describe, expect, spyOn, test } from "bun:test"
import { rmSync } from "node:fs"
import { configureSharedSubunitLogger } from "@oh-my-opencode/utils/logger"
import { withContractHost, type ContractHost } from "../../../../senpi-task/src/runners/rpc-host/testing/contract-host"
import { createLiveThreadSurface, type LiveThreadSurface } from "./live-surface"
import { createLazyLiveThreadSurface } from "./lazy-live-surface"

function surface(host: ContractHost): LiveThreadSurface {
  return createLiveThreadSurface(undefined, {
    env: { OMO_CODING_AGENT_DIR: host.root, SENPI_RPC_SOCKET: host.socket, SENPI_RPC_KEY_ROOT: host.root },
    statusAll: async () => undefined, registry: async () => [],
  })
}
function endpoint(host: ContractHost) {
  return { kind: "rpc_host" as const, socket: host.socket, routing_id: "rpc-1", durable_session_id: "dur-selected" }
}
const operations: readonly [string, (client: LiveThreadSurface, host: ContractHost) => Promise<unknown>][] = [
  ["interrupt", (client) => Reflect.apply(client.interrupt, client, ["rpc-1", undefined, "dur-selected"])],
  ["set_session_name", (client) => Reflect.apply(client.setSessionName, client, ["rpc-1", "renamed", "dur-selected"])],
  ["set_model", (client) => Reflect.apply(client.setModel, client, ["rpc-1", "p", "m", "dur-selected"])],
  ["set_thinking_level", (client) => Reflect.apply(client.setThinkingLevel, client, ["rpc-1", "high", "turn", "dur-selected"])],
  ["wake", (client, host) => client.gateway.wake(endpoint(host), ["delivery"])],
  ["release_session", (client, host) => client.gateway.releaseSession?.(endpoint(host), { reason: "takeover" }) ?? Promise.reject(new Error("gateway.releaseSession is missing"))],
  ["extension_ui_response", (client, host) => client.gateway.respondUi?.(endpoint(host), { ui_request_id: "question", fields: { value: "yes" } }) ?? Promise.reject(new Error("gateway.respondUi is missing"))],
]

/** Runs `exercise` while collecting the omo log lines and our lines written to stderr. */
async function capturingLogs(exercise: (lines: { readonly log: string[]; readonly stderr: () => string[] }) => Promise<void>): Promise<void> {
  const log: string[] = []
  configureSharedSubunitLogger((message) => { log.push(message) })
  const stderr = spyOn(process.stderr, "write")
  try {
    await exercise({ log, stderr: () => stderr.mock.calls.map((call) => String(call[0])).filter((line) => /thread rpc|senpi rpc/.test(line)) })
  } finally { stderr.mockRestore(); configureSharedSubunitLogger(undefined) }
}

describe("thread RPC attachment refusals and release outcomes (wire contract v1.1)", () => {
  // release_session and extension_ui_response answer with a reply union that carries the host's refusal; the rest throw a typed error.
  const typedRefusal = new Set(["release_session", "extension_ui_response"])
  test.each(operations.filter(([command]) => !typedRefusal.has(command)))("#given a draining host #when %s attaches #then a transient host_draining error surfaces and nothing is mutated, aborted or closed", async (_command, run) => {
    await withContractHost({ auth: true, attachRefusal: "host_draining" }, async (host) => {
      const refusal = await run(surface(host), host).then(() => undefined, (error: unknown) => error)
      expect(refusal).toBeInstanceOf(Error)
      expect((refusal as Error).message).toStartWith("host_draining:")
      expect(host.mutations).toEqual([])
      expect(host.frames.map(({ frame }) => frame.type))
        .toEqual(["get_protocol_info", ...(process.platform === "win32" ? [] : ["authenticate"]), "attach_session"])
    })
  })

  test("#given a draining host #when release_session attaches #then the release answers its typed host_draining refusal and nothing is mutated", async () => {
    await withContractHost({ auth: true, attachRefusal: "host_draining" }, async (host) => {
      expect(await surface(host).gateway.releaseSession?.(endpoint(host), { reason: "takeover" })).toMatchObject({ success: false, error: "host_draining" })
      expect(host.mutations).toEqual([])
    })
  })

  const vanished = [["unknown_session", { attachRefusal: "unknown_session" }], ["session_not_attached", { attachRefusal: "session_not_attached" }], ["session_identity_mismatch", { durableId: "dur-replacement" }]] as const
  test.each(vanished)("#given an attach refused %s #when release_session runs #then the release answers that code as its refusal", async (code, options) => {
    await withContractHost({ auth: true, ...options }, async (host) => {
      expect(await surface(host).gateway.releaseSession?.(endpoint(host), { reason: "takeover" })).toMatchObject({ success: false, error: code })
      expect(host.mutations).toEqual([])
    })
  })

  test("#given a draining host #when a relayed UI answer attaches #then the session's host_draining refusal is the reply, not a thrown error", async () => {
    await withContractHost({ auth: true, attachRefusal: "host_draining" }, async (host) => {
      expect(await surface(host).gateway.respondUi?.(endpoint(host), { ui_request_id: "question", fields: { value: "yes" } })).toEqual({ delivered: false, error: "host_draining" })
      expect(host.mutations).toEqual([])
    })
  })

  test("#given a caller the host holds no connection for #when attach is refused session_not_attached #then a typed session_not_attached error surfaces", async () => {
    await withContractHost({ auth: true, attachRefusal: "session_not_attached" }, async (host) => {
      const refusal = await Reflect.apply(surface(host).setSessionName, undefined, ["rpc-1", "renamed", "dur-selected"])
        .then(() => undefined, (error: unknown) => error)
      expect((refusal as Error).message).toStartWith("session_not_attached:")
      expect(host.mutations).toEqual([])
    })
  })

  test("#given a host that already dropped the hold #when the mutation succeeded and release answers session_not_attached #then the mutation result is returned as released", async () => {
    await withContractHost({ auth: true, afterMutation: "detached" }, async (host) => {
      await capturingLogs(async (lines) => {
        expect(await Reflect.apply(surface(host).setModel, undefined, ["rpc-1", "p", "m", "dur-selected"])).toEqual({ provider: "p", id: "m" })
        expect(host.mutations.map((frame) => frame.type)).toEqual(["set_model"])
        expect(host.frames.some(({ frame }) => frame.type === "release_attachment")).toBe(true)
        expect(lines.log.filter((line) => line.includes("release_attachment"))).toEqual([])
        expect(lines.stderr()).toEqual([])
      })
    })
  })

  test("#given a connection lost before release answers #when the mutation succeeded #then the mutation result is returned and the release failure is logged once to the omo log, not stderr", async () => {
    await withContractHost({ auth: true, afterMutation: "connection_lost" }, async (host) => {
      await capturingLogs(async (lines) => {
        expect(await Reflect.apply(surface(host).setModel, undefined, ["rpc-1", "p", "m", "dur-selected"])).toEqual({ provider: "p", id: "m" })
        expect(host.mutations.map((frame) => frame.type)).toEqual(["set_model"])
        expect(lines.log.filter((line) => line.includes("release_attachment"))).toHaveLength(1)
        expect(lines.stderr()).toEqual([])
      })
    })
  })

  test("#given an rpc_host endpoint with no routing id #when wake is sent to an attach-capable host #then no attachment is attempted and the session-less wake goes through", async () => {
    await withContractHost({ auth: true }, async (host) => {
      const reply = await surface(host).gateway.wake({ ...endpoint(host), routing_id: null }, ["delivery"])
      expect(reply).toEqual({ admitted: [] })
      expect(host.mutations.map((frame) => frame.type)).toEqual(["wake"])
      expect(host.mutations[0]).not.toHaveProperty("sessionId")
      expect(host.frames.some(({ frame }) => frame.type === "attach_session" || frame.type === "release_attachment")).toBe(false)
    })
  })

  test.skipIf(process.platform === "win32")("#given no key record for an enforcing host #when a mutation is refused auth_required #then the typed error carries the key-root remedy", async () => {
    await withContractHost({ auth: true, prepareRecord: (path) => { rmSync(path) } }, async (host) => {
      await capturingLogs(async () => {
        const refusal = await Reflect.apply(surface(host).setSessionName, undefined, ["rpc-1", "renamed", "dur-selected"])
          .then(() => undefined, (error: unknown) => error)
        expect((refusal as Error).message).toStartWith("auth_required:")
        expect((refusal as Error).message).toContain("SENPI_RPC_KEY_ROOT")
        expect(host.mutations).toEqual([])
      })
    })
  })

  test("#given an older host that refuses get_protocol_info #when a mutation runs #then it is sent unfenced, as before", async () => {
    await withContractHost({ legacy: true, refuseProtocolInfo: true }, async (host) => {
      await Reflect.apply(surface(host).setSessionName, undefined, ["rpc-1", "renamed", "dur-selected"])
      expect(host.mutations.map((frame) => frame.type)).toEqual(["set_session_name"])
      expect(host.frames.some(({ frame }) => frame.type === "attach_session" || frame.type === "authenticate")).toBe(false)
    })
  })

  test.skipIf(process.platform === "win32")("#given no key record for an enforcing host #when a read is refused auth_required #then the error names the endpoint and the key-root remedy", async () => {
    await withContractHost({ auth: true, prepareRecord: (path) => { rmSync(path) } }, async (host) => {
      await capturingLogs(async () => {
        const refusal = await surface(host).getMessages("rpc-1").then(() => undefined, (error: unknown) => error)
        expect((refusal as Error).message).toStartWith("auth_required:")
        expect((refusal as Error).message).toContain(host.socket)
        expect((refusal as Error).message).toContain("SENPI_RPC_KEY_ROOT")
      })
    })
  })

  test("#given a release_session that succeeded #when release_attachment answers v1.1 session_not_attached #then the hold counts as released and nothing is logged", async () => {
    await withContractHost({ auth: true }, async (host) => {
      await capturingLogs(async (lines) => {
        expect(await surface(host).gateway.releaseSession?.(endpoint(host), { reason: "takeover" })).toMatchObject({ success: true })
        expect(host.frames.some(({ frame }) => frame.type === "release_attachment")).toBe(true)
        expect(lines.log.filter((line) => line.includes("release_attachment"))).toEqual([])
      })
    })
  })

  test("#given a release_session that succeeded #when an out-of-contract host answers release_attachment unknown_session #then it is still released and nothing is logged", async () => {
    await withContractHost({ auth: true, releasedAttachmentAnswer: "unknown_session" }, async (host) => {
      await capturingLogs(async (lines) => {
        expect(await surface(host).gateway.releaseSession?.(endpoint(host), { reason: "takeover" })).toMatchObject({ success: true })
        expect(host.frames.some(({ frame }) => frame.type === "release_attachment")).toBe(true)
        expect(lines.log.filter((line) => line.includes("release_attachment"))).toEqual([])
      })
    })
  })
})

describe("thread RPC connection-local fenced mutations", () => {
  test.skipIf(process.platform === "win32").each(["environment", "option"] as const)("#given a separate client profile #when the key root comes from %s #then authentication leaves the target preset untouched", async (source) => {
    await withContractHost({ auth: true }, async (host) => {
      const client = createLiveThreadSurface(undefined, {
        env: { OMO_CODING_AGENT_DIR: `${host.root}/profile-b`, SENPI_RPC_SOCKET: host.socket,
          ...(source === "environment" ? { SENPI_RPC_KEY_ROOT: host.root } : {}) },
        ...(source === "option" ? { keyRoot: host.root } : {}),
        statusAll: async () => undefined, registry: async () => [],
      })
      await client.setSessionName("rpc-1", "renamed", "dur-selected")
      expect(host.mutations).toMatchObject([{ type: "set_session_name" }])
      expect(host.permissionPreset()).toBe("read-only")
    })
  })

  test.skipIf(process.platform === "win32")("#given an authenticated enforcing host #when a thread mutation runs #then proof succeeds before attachment", async () => {
    await withContractHost({ auth: true }, async (host) => {
      await Reflect.apply(surface(host).setSessionName, undefined, ["rpc-1", "renamed", "dur-selected"])
      expect(host.mutations).toMatchObject([{ type: "set_session_name" }])
      expect(host.frames.map(({ frame }) => frame.type))
        .toEqual(["get_protocol_info", "authenticate", "attach_session", "set_session_name", "release_attachment"])
    })
  })

  test.each(operations)("#given an enforcing host #when %s runs #then it attaches the selected identity on the same connection", async (command, run) => {
    await withContractHost({ auth: true }, async (host) => {
      await run(surface(host), host)
      expect(host.mutations.map((frame) => frame.type)).toEqual([command])
      const mutation = host.frames.find((entry) => entry.frame.type === command)
      if (mutation === undefined) throw new Error(`no ${command} frame`)
      expect(host.frames.filter((entry) => entry.connection === mutation.connection).map((entry) => entry.frame.type))
        .toEqual(["get_protocol_info", ...(process.platform === "win32" ? [] : ["authenticate"]), "attach_session", command, "release_attachment"])
      expect(host.frames.find((entry) => entry.frame.type === "attach_session")?.frame)
        .toMatchObject({ sessionId: "rpc-1", durableSessionId: "dur-selected" })
      expect(host.permissionPreset()).toBe("read-only")
    })
  })

  test.each(operations)("#given a replacement host reusing rpc-1 #when %s targets the prior durable id #then nothing is mutated", async (_command, run) => {
    await withContractHost({ durableId: "dur-replacement" }, async (host) => {
      await run(surface(host), host).catch(() => undefined)
      expect(host.frames.some((entry) => entry.frame.type === "attach_session")).toBe(true)
      expect(host.mutations).toEqual([])
      expect(host.frames.filter((entry) => !["get_protocol_info", "attach_session"].includes(String(entry.frame.type)))).toEqual([])
    })
  })

  test.each(operations)("#given a today host #when %s runs #then its command fields are unchanged and no attachment is attempted", async (command, run) => {
    await withContractHost({ legacy: true }, async (host) => {
      await run(surface(host), host)
      expect(host.mutations.map((frame) => frame.type)).toEqual([command])
      expect(host.frames.some((entry) => ["attach_session", "authenticate", "release_attachment"].includes(String(entry.frame.type)))).toBe(false)
      expect(host.mutations[0]).not.toHaveProperty("durableSessionId")
      expect(host.mutations[0]).not.toHaveProperty("durable_session_id")
    })
  })

  test("#given another attached caller #when releasing without force #then the original attached refusal survives", async () => {
    await withContractHost({ otherAttachments: 1 }, async (host) => {
      const client = surface(host)
      expect(await client.gateway.releaseSession?.(endpoint(host), { reason: "takeover" })).toEqual({ success: false, error: "attached" })
      expect(host.frames.some((entry) => entry.frame.type === "attach_session")).toBe(true)
      expect(await client.gateway.releaseSession?.(endpoint(host), { reason: "takeover", force: true })).toMatchObject({ success: true })
    })
  })

  test("#given read operations #when state messages and listing are read #then no attachment is acquired", async () => {
    await withContractHost({}, async (host) => {
      const client = surface(host)
      await client.listSessions()
      await client.getMessages("rpc-1")
      await client.getState("rpc-1")
      expect(host.frames.some((entry) => entry.frame.type === "attach_session")).toBe(false)
    })
  })

  test("#given a named thread create #when opened #then its name is set on the opening connection", async () => {
    await withContractHost({}, async (host) => {
      expect(await surface(host).openSession({ name: "created" })).toMatchObject({ durableSessionId: "dur-selected" })
      const opening = host.frames.find((entry) => entry.frame.type === "open_session")
      const naming = host.frames.find((entry) => entry.frame.type === "set_session_name")
      if (opening === undefined || naming === undefined) throw new Error("open_session or set_session_name frame missing")
      expect(naming.connection).toBe(opening.connection)
      expect(host.mutations).toMatchObject([{ type: "set_session_name", name: "created" }])
    })
  })

  test("#given lazy endpoint forwarding #when a selected session is renamed #then its durable identity survives the facade", async () => {
    await withContractHost({}, async (host) => {
      const client = createLazyLiveThreadSurface(undefined, { loadRuntime: async () => ({ createLiveThreadSurface: () => surface(host) }) })
      const port = client.endpoint(host.socket)
      await Reflect.apply(port.setSessionName, port, ["rpc-1", "renamed", "dur-selected"])
      expect(host.mutations).toMatchObject([{ type: "set_session_name" }])
      expect(host.frames.find((entry) => entry.frame.type === "attach_session")?.frame.durableSessionId).toBe("dur-selected")
    })
  })
})
