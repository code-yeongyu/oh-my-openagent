import { afterEach, describe, expect, jest, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { B, createTwoDevices, NAMES, ROUTE, T, type TwoDeviceOptions } from "./address/testing/two-devices"
import type { GatewayEndpointRef, ReleaseSessionRequest } from "./gateway/adapter"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { storeMigratedByNewerBuild } from "./gateway/testing/newer-schema"
import type { RemoteThreadSurface } from "./remote/ports"
import { createThreadSdk as createBundledThreadSdk } from "../../extension/thread-sdk"
import { createThreadSdk, type ThreadSdk } from "./sdk"
import { createRemoteThreadFixture, fakeRemoteClient } from "./thread-remote-fixture"
import type { ThreadHost, ThreadHostSession } from "./tools"
import type { ThreadHostViewRequest } from "./tools/ports"
import { startFakeEngineHost } from "./wake/testing/fake-engine-host"
import { remainingTestTime, useTestTimeout } from "../../../../../test-support/test-deadline"

const TUI_SOCKET = "/tmp/t-0123456789abcdef.sock"
const HOST_SOCKET = "/tmp/i-0123456789abcdef.sock"

const directories: string[] = []
const sdks: ThreadSdk[] = []
afterEach(async () => {
  await Promise.all(sdks.splice(0).map((sdk) => sdk.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture(
  options: {
    readonly release?: (endpoint: GatewayEndpointRef, request: ReleaseSessionRequest) => Promise<never>
    readonly store?: (agentDir: string) => GatewayStore
    readonly sdkOwnsStore?: boolean
    readonly remote?: RemoteThreadSurface
    readonly cwd?: string
    readonly noHostAnswering?: boolean
    readonly diskOnly?: readonly string[]
    /** Replaces the fixture's default sessions (used with the address module's two-device account). */
    readonly sessions?: readonly ThreadHostSession[]
    /** The host's session controls a test drives (open, interrupt, close, name, model); every other host method stays unused. */
    readonly controls?: Partial<ThreadHost>
  } = {},
) {
  const agentDir = mkdtempSync(join(tmpdir(), "thread-sdk-"))
  directories.push(agentDir)
  const store: GatewayStore = options.store?.(agentDir) ?? createGatewayStore({ agentDir })
  const hostSession: ThreadHostSession = {
    sessionId: "rpc-1",
    durableSessionId: "dur-host",
    cwd: process.cwd(),
    name: "host lane",
    status: "open",
    socket: HOST_SOCKET,
    endpoint_kind: "rpc_host",
  }
  const tuiSession: ThreadHostSession = {
    sessionId: "dur-tui",
    durableSessionId: "dur-tui",
    cwd: process.cwd(),
    name: "my-tui",
    status: "open",
    socket: TUI_SOCKET,
    endpoint_kind: "tui",
  }
  const sessionsDir = join(agentDir, "sessions", "--fixture--")
  mkdirSync(sessionsDir, { recursive: true })
  const diskOnly = (options.diskOnly ?? []).map((id) => ({ durableSessionId: id, cwd: process.cwd() }))
  const sessions = options.sessions ?? [hostSession, tuiSession]
  for (const session of [...sessions, ...diskOnly])
    writeFileSync(
      join(sessionsDir, `epoch_${session.durableSessionId}.jsonl`),
      JSON.stringify({
        type: "session",
        id: session.durableSessionId,
        cwd: session.cwd,
        timestamp: "2026-10-02T00:00:00Z",
      }) + "\n",
    )
  const wakes: { readonly endpoint: GatewayEndpointRef; readonly ids: readonly string[] }[] = []
  const releases: { readonly endpoint: GatewayEndpointRef; readonly request: ReleaseSessionRequest }[] = []
  const views: (ThreadHostViewRequest | undefined)[] = []
  const unused = async (): Promise<never> => {
    throw new Error("not used by the SDK")
  }
  const host: ThreadHost = {
    socket: "/tmp/thread-sdk-legacy.sock",
    listSessions: async () => [...sessions],
    listView: async (request) => {
      views.push(request)
      // The live surface's contract: when no endpoint answers it throws, unless the caller takes nothing live as the offline case.
      if (options.noHostAnswering === true) {
        if (request?.offline !== true) throw new Error("connect ECONNREFUSED")
        return { sessions: [], hosts: [], disk: [] }
      }
      const hosts = [
        ...new Map(
          sessions.flatMap((session) =>
            session.socket === undefined
              ? []
              : [
                  [
                    session.socket,
                    {
                      socket: session.socket,
                      list_sessions: { sessions: sessions.filter((listed) => listed.socket === session.socket) },
                      endpoint_kind: session.endpoint_kind,
                      alive: true as const,
                    },
                  ],
                ],
          ),
        ).values(),
      ]
      return { sessions, hosts, disk: [] }
    },
    openSession: unused,
    getMessages: async () => [{ role: "user", content: "hello from the host" }],
    getState: async () => ({ isStreaming: false }),
    prompt: unused,
    interrupt: unused,
    setSessionName: unused,
    setModel: unused,
    getAvailableModels: unused,
    setThinkingLevel: unused,
    getAvailableThinkingLevels: unused,
    ...options.controls,
    gateway: {
      wake: async (endpoint, ids) => {
        wakes.push({ endpoint, ids })
        return { admitted: [] }
      },
      releaseSession:
        options.release ??
        (async (endpoint, request) => {
          releases.push({ endpoint, request })
          return {
            success: true,
            data: {
              released: true,
              session_path: "/sessions/dur-host.jsonl",
              attachments: 0,
              dropped: { deliveries: ["d-1"], user_messages: ["queued ask"] },
            },
          }
        }),
    },
  }
  const sdk = createThreadSdk({
    agentDir,
    cwd: options.cwd ?? process.cwd(),
    uid: 501,
    user: "qa-user",
    host,
    ...(options.sdkOwnsStore === true ? {} : { store }),
    ...(options.remote === undefined ? {} : { remote: options.remote }),
    // No session this fixture's host opens drains its inbox, so a create's first prompt is not waited for.
    firstPromptWaitMs: 0,
  })
  sdks.push(sdk)
  return { sdk, store, wakes, releases, views }
}

/** The remote surface with every device-service and alias-registry call it takes recorded by method name. */
function countingRemote(remote: RemoteThreadSurface): {
  readonly remote: RemoteThreadSurface
  readonly calls: string[]
} {
  const calls: string[] = []
  const counted = <T extends object>(port: T, prefix = ""): T =>
    new Proxy(port, {
      get: (target, key, receiver) => {
        const value: unknown = Reflect.get(target, key, receiver)
        if (typeof value !== "function") return value
        return (...args: unknown[]) => {
          calls.push(`${prefix}${String(key)}`)
          return Reflect.apply(value, target, args)
        }
      },
    })
  return {
    remote: {
      ...remote,
      sessions: counted(remote.sessions),
      client: {
        ...remote.client,
        service: counted(remote.client.service, "client.service."),
        devices: counted(remote.client.devices, "client.devices."),
        sessions: counted(remote.client.sessions, "client.sessions."),
      },
      ...(remote.aliases === undefined ? {} : { aliases: counted(remote.aliases) }),
    },
    calls,
  }
}

describe("thread SDK: options are checked at the boundary", () => {
  test.each([
    ["the bundled entry", createBundledThreadSdk],
    ["the component", createThreadSdk],
  ] as const)(
    "#given %s #when created without options or without agentDir #then it throws a TypeError naming the missing fields",
    (_entry, create) => {
      const call = create as (options?: unknown) => ThreadSdk
      expect(() => call()).toThrow(
        new TypeError(
          "createThreadSdk needs { agentDir, cwd, uid, user }; missing or invalid: agentDir, cwd, user, uid",
        ),
      )
      expect(() => call({ cwd: process.cwd(), uid: 501, user: "q" })).toThrow(
        new TypeError("createThreadSdk needs { agentDir, cwd, uid, user }; missing or invalid: agentDir"),
      )
    },
  )
})

describe("thread SDK: sessions", () => {
  test("#given a host and a terminal session #when listed and read #then rows carry surface and the live transcript comes from the session's endpoint", async () => {
    const { sdk } = fixture()
    const listed = await sdk.list({})
    expect(listed).toMatchObject({
      kind: "ok",
      scope: "workspace",
      threads: [
        { thread: "dur-host", surface: "desktop" },
        { thread: "dur-tui", surface: "tui" },
      ],
    })
    expect(await sdk.read({ thread: "host lane" })).toMatchObject({
      kind: "ok",
      thread: "dur-host",
      items: [{ seq: 1, role: "user", content: JSON.stringify("hello from the host") }],
    })
  })

  test("#given a terminal session #when the CLI sends to it #then the row is written by the cli principal with a cli origin and only a wake reaches the terminal", async () => {
    const { sdk, store, wakes } = fixture()
    const sent = await sdk.send({ thread: "my-tui", text: "ping" })
    expect(sent).toMatchObject({ kind: "ok", endpoint_kind: "tui", effective_mode: "auto", deduplicated: false })
    const rows = await store.list({ target_durable_id: "dur-tui" })
    expect(rows.map((row) => ({ sender: row.sender, origin: row.envelope.origin, actor: row.envelope.actor }))).toEqual(
      [
        {
          sender: "cli:501",
          origin: {
            external: {
              platform: "cli",
              account_id: "qa-user",
              chat_id: "@cli",
              thread_id: "@chat",
              message_id: rows[0]?.delivery_id ?? "",
            },
          },
          actor: "qa-user",
        },
      ],
    )
    expect(wakes.map((wake) => wake.endpoint.kind)).toEqual(["tui"])
    expect(sdk.principal).toBe("cli:501")
  })

  // The send shape chat connectors call by session id (#14312): this is the SDK's only delivery entry point.
  test("#given a session id #when a script sends with thread, text, mode, all_scope and an idempotency key, twice #then the first answers its delivery and the repeat replays it deduplicated", async () => {
    const { sdk, store } = fixture()
    const request = {
      thread: "dur-tui",
      text: "from the chat",
      mode: "follow_up" as const,
      all_scope: true,
      idempotency_key: "event-1",
    }
    const first = await sdk.send(request)
    if (first.kind !== "ok") throw new Error(JSON.stringify(first))
    expect({
      thread: first.thread,
      deliveryId: typeof first.delivery_id,
      deduplicated: first.deduplicated,
      delivery: first.delivery.kind,
    }).toEqual({
      thread: "dur-tui",
      deliveryId: "string",
      deduplicated: false,
      delivery: expect.stringMatching(/^(queued|queued_offline|started|steered)$/),
    })
    expect(await sdk.send(request)).toMatchObject({
      kind: "ok",
      thread: "dur-tui",
      delivery_id: first.delivery_id,
      deduplicated: true,
    })
    expect((await store.list({ target_durable_id: "dur-tui" })).map((row) => row.body)).toEqual(["from the chat"])
  })
})

describe("thread SDK: unknown option keys (#14316)", () => {
  test("#given a script that passes no options object, or a non-object #when it calls the SDK #then list() lists and the others answer invalid_arguments", async () => {
    const { sdk } = fixture()
    const loose = sdk as unknown as Record<"list" | "read" | "send" | "locate", (request?: unknown) => Promise<unknown>>
    expect(await loose.list()).toMatchObject({ kind: "ok" })
    for (const method of ["read", "send", "locate"] as const)
      for (const request of [undefined, null, "dur-tui", ["dur-tui"]])
        expect(await loose[method](request)).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
  })

  test.each([
    ["send", { thread: "dur-tui", text: "ping", allScope: true }, ["allScope"]],
    ["read", { thread: "dur-tui", maxBytes: 10 }, ["maxBytes"]],
    ["list", { all_scope: true, State: ["idle"] }, ["State"]],
    ["locate", { thread: "dur-tui", binding_id: "bnd-1" }, ["binding_id"]],
  ] as const)(
    "#given %s with a key it does not read #when called #then it is invalid_arguments naming the key and nothing is written",
    async (method, request, unknown) => {
      const { sdk, store } = fixture()
      const call = sdk[method] as (value: unknown) => Promise<unknown>
      expect(await call(request)).toMatchObject({
        kind: "error",
        error: { code: "invalid_arguments", message: `Unknown option: ${unknown[0]}.`, details: { unknown } },
      })
      expect(await store.list()).toEqual([])
    },
  )
})

describe("thread SDK: a send with no remote surface resolves through the address module (#14322)", () => {
  const HEX = "0cc00001-0000-4000-8000-000000000001"
  const hexSession: ThreadHostSession = {
    sessionId: "rpc-7",
    durableSessionId: HEX,
    cwd: process.cwd(),
    name: "hex lane",
    status: "open",
    socket: HOST_SOCKET,
    endpoint_kind: "rpc_host",
  }

  test.each([
    ["here/<thread id>", `here/${HEX}`],
    ["a thread name", "hex lane"],
    ["an 8-hex id prefix", HEX.slice(0, 8)],
  ])(
    "#given no remote surface #when the CLI sends to %s #then it is delivered to that local thread",
    async (_form, thread) => {
      const { sdk, store } = fixture({ sessions: [hexSession] })
      expect(await sdk.send({ thread, text: "ping" })).toMatchObject({ kind: "ok" })
      expect((await store.list({ target_durable_id: HEX })).length).toBe(1)
    },
  )

  test("#given no remote surface #when the CLI sends to <other device>/<id> #then the address module's typed refusal answers and nothing is written", async () => {
    const { sdk, store } = fixture({ sessions: [hexSession] })
    expect(await sdk.send({ thread: `b7c41e09d2a64f1e/${HEX}`, text: "ping" })).toMatchObject({
      kind: "error",
      error: { code: "not_found", details: { kind: "thread" } },
    })
    expect(await store.list()).toEqual([])
  })

  test("#given an id this device's gateway store owns #when the CLI sends to it #then no host listing is read (the published-id shortcut)", async () => {
    const { sdk, store, views } = fixture({ sessions: [hexSession] })
    await store.registerIncarnation({ durable_id: HEX, incarnation: "runtime-1" })
    expect(await sdk.send({ thread: HEX, text: "ping" })).toMatchObject({ kind: "ok" })
    expect(views).toEqual([])
  })
})

describe("thread SDK: a gateway store a newer omo build migrated", () => {
  test("#given the agent dir's store is at a schema newer than this binary's #when omo thread send runs #then it answers gateway_schema_too_new naming both schemas and the update command", async () => {
    let versions = { gateway: 0, binary: 0 }
    const { sdk } = fixture({
      store: (agentDir) => {
        versions = storeMigratedByNewerBuild(agentDir)
        return createGatewayStore({ agentDir })
      },
    })
    const sent = await sdk.send({ thread: "my-tui", text: "ping" })
    expect(sent).toMatchObject({
      kind: "error",
      error: {
        code: "gateway_schema_too_new",
        details: {
          gateway_schema: versions.gateway,
          binary_schema: versions.binary,
          update_command: "omo update",
        },
      },
    })
  })
})

describe("thread SDK: read reaches the account like the agent tools (#12833)", () => {
  const remoteFixture = createRemoteThreadFixture()
  afterEach(remoteFixture.cleanup)

  test("#given a thread on b #when omo thread list runs #then b's thread is listed with its device beside this device's, as the agent's thread_list lists it", async () => {
    const account = remoteFixture.account()
    const { sdk } = fixture({ remote: account.remote })
    const listed = await sdk.list({})
    expect(listed.kind === "ok" && "threads" in listed && listed.threads.find((t) => t.device === "b")).toMatchObject({
      thread: "dur-on-b",
    })
  })

  test("#given aliases held by a thread here and by one on b #when omo thread read names each alias #then the first reads this device's transcript and the second b's", async () => {
    const account = remoteFixture.account({
      aliases: new Map([
        ["lane-here", { session_id: "dur-host", device: "here" }],
        ["lane-b", { session_id: "dur-on-b", device: "b" }],
      ]),
    })
    const { sdk } = fixture({ remote: account.remote })
    expect(await sdk.read({ thread: "lane-here" })).toMatchObject({ kind: "ok", thread: "dur-host" })
    expect(await sdk.read({ thread: "lane-b" })).toMatchObject({ kind: "ok", thread: "dur-on-b", device: "b" })
    expect(
      account.sent.filter((entry) => entry.via === "session").map((entry) => [entry.device, entry.rpc?.["type"]]),
    ).toEqual([
      ["b", "get_entries"],
      ["b", "get_messages"],
    ])
  })

  test("#given an alias held by a thread on this device and omo thread run from another workspace #when read and send name the alias without all_scope #then both reach that thread; the raw id alone stays scope_denied", async () => {
    const account = remoteFixture.account({
      aliases: new Map([["lane-here", { session_id: "dur-host", device: "here" }]]),
    })
    const { sdk, store } = fixture({ remote: account.remote, cwd: "/thread-sdk-other-workspace" })
    expect(await sdk.read({ thread: "lane-here" })).toMatchObject({ kind: "ok", thread: "dur-host" })
    expect(await sdk.read({ thread: "dur-host" })).toMatchObject({ kind: "error", error: { code: "scope_denied" } })
    expect(await sdk.send({ thread: "lane-here", text: "ping" })).toMatchObject({ kind: "ok", deduplicated: false })
    expect((await store.list({ target_durable_id: "dur-host" })).map((row) => row.sender)).toEqual(["cli:501"])
  })

  test("#given a thread that is not running and no host or terminal answering #when omo thread send names it by id and by an own alias #then both are stored queued_offline, never internal_error (#12860)", async () => {
    const account = remoteFixture.account({
      aliases: new Map([["lane-off", { session_id: "dur-off", device: "here" }]]),
    })
    const { sdk, store } = fixture({ remote: account.remote, noHostAnswering: true, diskOnly: ["dur-off"] })
    expect(await sdk.send({ thread: "dur-off", text: "by id" })).toMatchObject({
      kind: "ok",
      delivery: { kind: "queued_offline" },
    })
    expect(await sdk.send({ thread: "lane-off", text: "by alias" })).toMatchObject({
      kind: "ok",
      delivery: { kind: "queued_offline" },
    })
    expect((await store.list({ target_durable_id: "dur-off" })).map((row) => row.sender)).toEqual([
      "cli:501",
      "cli:501",
    ])
  })

  // Q's steer-all order (omo#14972): a parked session is woken by a send from the CLI or the gateway's seat sends, as by
  // an agent's thread_send; the process has no carrier, so it records the wake for the device's running carrier.
  test("#given a parked interactive thread #when omo thread send names it #then a wake is requested for it and the answer says no carrier here took it", async () => {
    const { sdk, store } = fixture({ noHostAnswering: true, diskOnly: ["dur-parked"] })

    const sent = await sdk.send({ thread: "dur-parked", text: "wake up" })

    expect(sent).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline", reason: "wake_unavailable" } })
    expect((await store.woken.list()).map((row) => ({ durable_id: row.durable_id, state: row.state }))).toEqual([
      { durable_id: "dur-parked", state: "requested" },
    ])
  })

  test("#given a published thread id and the account surface set #when omo thread send names that id #then it is delivered with no host listing, no alias call and no listing, and its one device-service call is the device read that stamps its sender device (#12860, #13004)", async () => {
    const account = remoteFixture.account({
      aliases: new Map([["lane-here", { session_id: "dur-host", device: "here" }]]),
    })
    const counting = countingRemote(account.remote)
    const { sdk, store, views } = fixture({ remote: counting.remote })
    await store.registerIncarnation({
      durable_id: "dur-host",
      incarnation: "rpc-1",
      endpoint: { kind: "rpc_host", socket: HOST_SOCKET },
    })
    expect(await sdk.send({ thread: "dur-host", text: "ping" })).toMatchObject({ kind: "ok", deduplicated: false })
    expect((await store.list({ target_durable_id: "dur-host" })).map((row) => row.sender)).toEqual(["cli:501"])
    expect(views).toEqual([])
    // Decision 0027 section 3: every delivery names its sender device, read once and kept for the process.
    expect(counting.calls).toEqual(["client.devices.list"])
    expect((await store.list({ target_durable_id: "dur-host" }))[0]?.envelope.provenance?.device).toBe("here")
    expect(await sdk.send({ thread: "dur-host", text: "again" })).toMatchObject({ kind: "ok" })
    expect(counting.calls).toEqual(["client.devices.list"])
  })

  test("#given the device service cannot answer #when omo thread send names a thread here #then the send still goes and its row names why it carries no sender device (#13004)", async () => {
    const account = remoteFixture.account()
    const down = {
      ...account.remote,
      client: fakeRemoteClient({
        state: () => "connected",
        here: "here",
        devices: () => [],
        fail: { kind: "error", code: "host_unavailable", message: "device service down", next_action: "Retry." },
      }),
    }
    const { sdk, store } = fixture({ remote: down })
    await store.registerIncarnation({
      durable_id: "dur-host",
      incarnation: "rpc-1",
      endpoint: { kind: "rpc_host", socket: HOST_SOCKET },
    })
    expect(await sdk.send({ thread: "dur-host", text: "ping" })).toMatchObject({ kind: "ok", deduplicated: false })
    const provenance = (await store.list({ target_durable_id: "dur-host" }))[0]?.envelope.provenance
    expect({ device: provenance?.device, device_absent: provenance?.device_absent }).toEqual({
      device: undefined,
      device_absent: "device_service_unavailable",
    })
  })

  test("#given a thread on b #when omo thread send names it #then it reaches b as this person's own input (the omo remote send path; the engine admits no command-line delivery from another machine), while a send to a thread here still delivers as cli (#14616)", async () => {
    const account = remoteFixture.account({ aliases: new Map([["lane-b", { session_id: "dur-on-b", device: "b" }]]) })
    const { sdk, store } = fixture({ remote: account.remote })
    expect(await sdk.send({ thread: "lane-b", text: "ping b" })).toMatchObject({
      kind: "ok",
      device: "b",
      thread: "dur-on-b",
    })
    // The person's own input: a plain prompt, no delivery envelope, exactly what `omo remote send` puts on the wire.
    expect(account.sent).toEqual([
      expect.objectContaining({
        via: "session",
        device: "b",
        session: "rk-on-b",
        rpc: expect.objectContaining({ type: "prompt", message: "ping b", sessionId: "rk-on-b" }),
      }),
    ])
    expect(await sdk.send({ thread: "my-tui", text: "ping here" })).toMatchObject({
      kind: "ok",
      endpoint_kind: "tui",
      deduplicated: false,
    })
    expect((await store.list({ target_durable_id: "dur-tui" })).map((row) => row.sender)).toEqual(["cli:501"])
  })
})

describe("thread SDK: every address form through the shared resolver (#14305)", () => {
  const twos: ReturnType<typeof createTwoDevices>[] = []
  afterEach(() => {
    for (const two of twos.splice(0)) two.cleanup()
  })
  const twoDevices = (options: TwoDeviceOptions = {}) => {
    const two = createTwoDevices(options)
    twos.push(two)
    return two
  }
  // The fixture's own HERE_SESSIONS / HERE_DISK are not exported (the module branch pruned unused
  // names): rebuilt here from its exported ids, routing ids and names, on one rpc_host socket.
  const hereDisk: readonly string[] = [T.hereEnded, T.stale]
  const hereSessions: readonly ThreadHostSession[] = (
    [
      [T.hereLive, ROUTE.hereLive, NAMES.hereLive],
      [T.hereShared, ROUTE.hereShared, NAMES.shared],
      [T.hereSlash, ROUTE.hereSlash, NAMES.slash],
    ] as const
  ).map(([durableSessionId, sessionId, name]) => ({
    sessionId,
    durableSessionId,
    cwd: process.cwd(),
    name,
    status: "open" as const,
    socket: HOST_SOCKET,
    endpoint_kind: "rpc_host" as const,
  }))
  const sdkOn = (two: ReturnType<typeof createTwoDevices>) =>
    fixture({ remote: two.remote, sessions: hereSessions, diskOnly: [...hereDisk] })

  test("#given a thread on device B #when locate names it by name and by <device>/<id> #then the located row keeps the local shape and adds its device and address", async () => {
    const { sdk } = sdkOn(twoDevices())
    expect(await sdk.locate({ thread: NAMES.bLive })).toMatchObject({
      kind: "ok",
      thread: {
        thread_id: T.bLive,
        title: NAMES.bLive,
        status: "live",
        cwd: "/work/b",
        endpoint: null,
        alive: true,
        device: B.id,
        address: `${B.id}/${T.bLive}`,
      },
    })
    expect(await sdk.locate({ thread: `${B.name}/${T.bLive}` })).toMatchObject({
      kind: "ok",
      thread: { thread_id: T.bLive, device: B.id },
    })
    // A local thread keeps today's result byte for byte: no device, no address.
    const local = await sdk.locate({ thread: NAMES.hereLive })
    expect(local).toMatchObject({
      kind: "ok",
      thread: {
        thread_id: T.hereLive,
        endpoint: {
          kind: "rpc_host",
          socket: HOST_SOCKET,
          routing_id: ROUTE.hereLive,
          durable_session_id: T.hereLive,
        },
        surface: "desktop",
        alive: true,
      },
    })
    if (local.kind !== "ok") throw new Error("locate of a local thread failed")
    expect(local.thread).not.toHaveProperty("device")
    expect(local.thread).not.toHaveProperty("address")
  })

  test("#given a thread on device B #when send addresses it by <device name>/<id> and by <device prefix>/<id prefix> #then each resolves there and reaches B as the person's own input (#14616)", async () => {
    const two = twoDevices()
    const { sdk } = sdkOn(two)
    for (const address of [`${B.name}/${T.bLive}`, `${B.id.slice(0, 6)}/${T.bLive.slice(0, 8)}`]) {
      expect(await sdk.send({ thread: address, text: "ping" })).toMatchObject({
        kind: "ok",
        device: B.id,
        thread: T.bLive,
      })
    }
    expect(
      two.account.sent.filter((entry) => entry.via === "session").map((entry) => (entry.rpc as { type?: string }).type),
    ).toEqual(["prompt", "prompt"])
  })

  test("#given a thread on this device #when read names it here/<id> #then it reads this device's transcript (surface pin: the control path already resolves it)", async () => {
    const { sdk } = sdkOn(twoDevices())
    expect(await sdk.read({ thread: `here/${T.hereLive}` })).toMatchObject({ kind: "ok", thread: T.hereLive })
  })

  test("#given device B missed the listing round #when locate names a thread only B holds #then it answers host_unavailable naming B, never not_found", async () => {
    const { sdk } = sdkOn(twoDevices({ incomplete: true }))
    expect(await sdk.locate({ thread: NAMES.bLive })).toMatchObject({
      kind: "error",
      error: { code: "host_unavailable", details: { reason: "listing_incomplete", devices: [B.id] } },
    })
  })
})

describe("thread SDK: takeover", () => {
  test("#given a host session #when located and released #then the release carries reason takeover and the flags on the serving endpoint", async () => {
    const { sdk, releases } = fixture()
    const located = await sdk.locate({ thread: "host lane" })
    expect(located).toMatchObject({
      kind: "ok",
      thread: {
        thread_id: "dur-host",
        surface: "desktop",
        alive: true,
        endpoint: { kind: "rpc_host", socket: HOST_SOCKET, routing_id: "rpc-1", durable_session_id: "dur-host" },
      },
    })
    if (located.kind !== "ok") throw new Error("located")
    expect(await sdk.release(located.thread, { interrupt: true })).toMatchObject({
      success: true,
      data: { session_path: "/sessions/dur-host.jsonl" },
    })
    expect(releases).toEqual([
      {
        endpoint: { kind: "rpc_host", socket: HOST_SOCKET, routing_id: "rpc-1", durable_session_id: "dur-host" },
        request: { reason: "takeover", interrupt: true },
      },
    ])
  })

  test("#given an endpoint that fails in transport #when released #then the failure is data, never a throw", async () => {
    const { sdk } = fixture({
      release: async () => {
        throw new Error(`host_unavailable:${HOST_SOCKET}`)
      },
    })
    const located = await sdk.locate({ thread: "dur-host" })
    if (located.kind !== "ok") throw new Error("located")
    expect(await sdk.release(located.thread, {})).toMatchObject({ success: false, error: "host_unavailable" })
  })
})

// #13413: the session controls a script runs, through the same bodies as the agent tools (locateControl + control/operations.ts,
// and the shared create body over the SessionHost port), acting as the SDK's own caller (no session identity, like read).
describe("thread SDK: session controls (#13413)", () => {
  const remoteFixture = createRemoteThreadFixture()
  afterEach(remoteFixture.cleanup)

  function controlled() {
    const calls: unknown[][] = []
    const opened: ThreadHostSession = {
      sessionId: "rpc-2",
      durableSessionId: "dur-new",
      cwd: process.cwd(),
      name: "fresh lane",
      status: "open",
      socket: HOST_SOCKET,
      endpoint_kind: "rpc_host",
    }
    const openSession: NonNullable<ThreadHost["openSession"]> = async (request) => {
      calls.push(["openSession", request])
      return opened
    }
    const controls: Partial<ThreadHost> = {
      openSession,
      interrupt: async (...args) => {
        calls.push(["interrupt", ...args])
        return { interrupted: true, turnId: "turn-7" }
      },
      closeSession: async (...args) => {
        calls.push(["closeSession", ...args])
        return { outcome: "closed", dropped_deliveries: [] }
      },
      setSessionName: async (...args) => {
        calls.push(["setSessionName", ...args])
      },
      getAvailableModels: async () => [
        { provider: "anthropic", id: "claude-opus", name: "Opus" },
        { provider: "openai", id: "gpt-6" },
      ],
      setModel: async (...args) => {
        calls.push(["setModel", ...args])
        return { provider: args[1], id: args[2] }
      },
    }
    return { calls, controls, openSession }
  }

  test("#given a host session here #when a script interrupts it #then the host's interrupt runs on that session and the result names the stopped turn", async () => {
    const { calls, controls } = controlled()
    const { sdk } = fixture({ controls })
    expect(await sdk.interrupt({ thread: "host lane" })).toEqual({
      kind: "ok",
      thread: "dur-host",
      turn_id: "turn-7",
      interrupted: true,
      background: { status: "not_supported" },
    })
    expect(calls).toEqual([["interrupt", "rpc-1", { background: "stop" }, "dur-host"]])
  })

  test("#given a host session and a terminal session here #when a script closes each #then the host closes its session and the terminal's refusal comes back as unsupported data with nothing called", async () => {
    const { calls, controls } = controlled()
    const { sdk } = fixture({ controls })
    expect(await sdk.close({ thread: "host lane" })).toEqual({
      kind: "ok",
      thread: "dur-host",
      closed: true,
      reason: "closed",
      dropped_deliveries: [],
    })
    expect(await sdk.close({ thread: "my-tui" })).toMatchObject({
      kind: "error",
      error: { code: "unsupported", details: { command: "close_session" } },
    })
    expect(calls).toEqual([["closeSession", "rpc-1", "dur-host", {}]])
  })

  test("#given a host session here #when a script renames it, then to a name another thread holds, then with nothing to change #then the first is set on the host and the others are refused as data before anything changes", async () => {
    const { calls, controls } = controlled()
    const { sdk } = fixture({ controls })
    expect(await sdk.rename({ thread: "host lane", name: "  renamed lane " })).toEqual({
      kind: "ok",
      thread: "dur-host",
      name: "renamed lane",
    })
    expect(await sdk.rename({ thread: "dur-host", name: "MY-TUI" })).toMatchObject({
      kind: "error",
      error: { code: "name_conflict" },
    })
    expect(await sdk.rename({ thread: "dur-host" })).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments" },
    })
    expect(calls).toEqual([["setSessionName", "rpc-1", "renamed lane", "dur-host"]])
  })

  test("#given a host session here #when a script sets its model by a fragment and by one no catalog lists #then the fragment resolves on the session's catalog and the miss is model_not_found with nothing set", async () => {
    const { calls, controls } = controlled()
    const { sdk } = fixture({ controls })
    expect(await sdk.set_model({ thread: "host lane", model: "opus" })).toEqual({
      kind: "ok",
      thread: "dur-host",
      model: { provider: "anthropic", id: "claude-opus" },
    })
    expect(await sdk.set_model({ thread: "host lane", model: "no-such-model" })).toMatchObject({
      kind: "error",
      error: { code: "model_not_found" },
    })
    expect(calls).toEqual([["setModel", "rpc-1", "anthropic", "claude-opus", "dur-host"]])
  })

  test("#given this device's host #when a script creates a named thread, then another under a taken name #then the first opens in the script's cwd and the second is name_conflict with nothing opened", async () => {
    const { calls, controls } = controlled()
    const { sdk } = fixture({ controls })
    expect(await sdk.create({ name: "fresh lane" })).toMatchObject({
      kind: "ok",
      thread: "dur-new",
      name: "fresh lane",
      deduplicated: false,
    })
    expect(await sdk.create({ name: "my-tui" })).toMatchObject({ kind: "error", error: { code: "name_conflict" } })
    expect(await sdk.create({})).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect(calls).toEqual([
      [
        "openSession",
        expect.objectContaining({ cwd: process.cwd(), name: "fresh lane", durableSessionId: expect.any(String) }),
      ],
    ])
  })

  test("#given this device's host #when a script creates a thread with a first prompt that no drain takes #then the thread opens, the prompt is the script's own row, and the create fails prompt_not_started", async () => {
    const { calls, controls, openSession } = controlled()
    // The host lists the session it opened, as a real one does once open_session answers.
    let listed: ThreadHostSession[] = []
    const { sdk, store } = fixture({
      controls: {
        ...controls,
        openSession: async (request) => {
          const session = await openSession(request)
          listed = [session]
          return session
        },
        listView: async () => ({
          sessions: listed,
          hosts: [{ socket: HOST_SOCKET, list_sessions: { sessions: listed }, endpoint_kind: "rpc_host", alive: true }],
          disk: [],
        }),
      },
    })
    const created = await sdk.create({ prompt: "start the nightly build", idempotency_key: "nightly-1" })
    expect(created).toMatchObject({
      kind: "error",
      error: { code: "prompt_not_started", details: { thread: "dur-new", delivery_id: expect.any(String) } },
    })
    expect(calls.filter(([what]) => what === "openSession")).toHaveLength(1)
    const rows = await store.list({ target_durable_id: "dur-new" })
    expect(
      rows.map((row) => ({
        sender: row.sender,
        authority: row.envelope.authority,
        body: row.body,
        mode: row.mode_requested,
      })),
    ).toEqual([{ sender: "cli:501", authority: "creator", body: "start the nightly build", mode: "auto" }])
  })

  test("#given a script with no session of its own #when it addresses self #then every control verb answers caller_context_missing and nothing runs", async () => {
    const { calls, controls } = controlled()
    const { sdk } = fixture({ controls })
    for (const result of [
      await sdk.interrupt({ thread: "self" }),
      await sdk.close({ thread: "self" }),
      await sdk.close({}),
      await sdk.rename({ thread: "self", name: "mine" }),
      await sdk.rename({ name: "mine" }),
      await sdk.set_model({ thread: "self", model: "opus" }),
    ])
      expect(result).toMatchObject({ kind: "error", error: { code: "caller_context_missing" } })
    expect(calls).toEqual([])
  })

  test("#given a thread on device b #when a script interrupts, renames, sets the model of and closes it #then each runs on b's engine through the device service and names device b", async () => {
    const account = remoteFixture.account({ aliases: new Map([["lane-b", { session_id: "dur-on-b", device: "b" }]]) })
    const { sdk } = fixture({ remote: account.remote })
    expect(await sdk.interrupt({ thread: "lane-b" })).toEqual({
      kind: "ok",
      thread: "dur-on-b",
      device: "b",
      interrupted: false,
      background: { status: "not_supported" },
    })
    expect(await sdk.rename({ thread: "lane-b", name: "renamed on b", alias: "lane-b2" })).toEqual({
      kind: "ok",
      thread: "dur-on-b",
      device: "b",
      name: "renamed on b",
      alias: "lane-b2",
    })
    expect(account.aliases.get("lane-b2")).toEqual({ session_id: "dur-on-b", device: "b" })
    expect(await sdk.set_model({ thread: "lane-b2", model: "gpt-6" })).toEqual({
      kind: "ok",
      thread: "dur-on-b",
      device: "b",
      model: { provider: "openai", id: "gpt-6" },
    })
    expect(await sdk.close({ thread: "lane-b2" })).toEqual({
      kind: "ok",
      thread: "dur-on-b",
      device: "b",
      closed: true,
      reason: "closed",
      dropped_deliveries: [],
    })
    expect(
      account.sent
        .filter((entry) => entry.device === "b" && entry.rpc !== undefined)
        .map((entry) => entry.rpc?.["type"])
        .filter((type) => type !== "get_state"),
    ).toEqual(["interrupt", "set_session_name", "get_available_models", "set_model", "unload_session"])
  })

  test("#given a thread that ended on device b #when a script closes it #then it answers closed false for device b and nothing reaches b's engine", async () => {
    const account = remoteFixture.account({
      rowState: "ended",
      aliases: new Map([["lane-b", { session_id: "dur-on-b", device: "b" }]]),
    })
    const { sdk } = fixture({ remote: account.remote })
    expect(await sdk.close({ thread: "lane-b" })).toEqual({
      kind: "ok",
      thread: "dur-on-b",
      device: "b",
      closed: false,
      reason: "not_live",
      dropped_deliveries: [],
    })
    expect(account.sent.filter((entry) => entry.via === "session")).toEqual([])
  })

  test("#given device b online #when a script creates a thread on b #then b's engine opens it and the result names device b", async () => {
    const account = remoteFixture.account()
    const { sdk } = fixture({ remote: account.remote })
    expect(await sdk.create({ device: "b", name: "lane on b" })).toMatchObject({
      kind: "ok",
      thread: "dur-new-on-b",
      device: "b",
      deduplicated: false,
    })
    expect(account.sent.some((entry) => entry.device === "b" && entry.rpc?.["type"] === "open_session")).toBe(true)
  })
})

// #13037 cold wake: `omo daemon run` has the operator daemon load omo with no session open, so its thread component
// declares the delivery consumer before any session runs. The SDK asks the host thread_create opens sessions on.
describe("thread SDK: the operator daemon's warm", () => {
  test.each([
    ["warms its default profile", undefined, { kind: "warm", state: "warmed" }],
    ["is draining", { success: false, error: "host_draining" }, { kind: "refused", code: "host_draining" }],
    ["predates warm", { success: false, error: "unknown_command" }, { kind: "unsupported" }],
  ] as const)(
    "#given an operator daemon that %s #when the SDK warms it #then one session-less warm reaches that host and its answer is classified",
    async (_what, reply, expected) => {
      const host = await startFakeEngineHost(reply === undefined ? {} : { warm: () => reply })
      try {
        const warmSdk = createThreadSdk({
          agentDir: mkdtempSync(join(tmpdir(), "thread-sdk-warm-")),
          cwd: process.cwd(),
          uid: 501,
          user: "tester",
          env: { OMO_RPC_SOCKET_PATH: host.socketPath },
        })
        sdks.push(warmSdk)
        expect(await warmSdk.warmDaemon()).toEqual(expected)
        expect(host.frames.filter((frame) => frame.type === "warm")).toEqual([{ id: expect.any(String), type: "warm" }])
      } finally {
        await host.close()
      }
    },
  )
})

describe("#14333: the SDK's default delivery mode", () => {
  test("#given a send that names no mode #when it is stored #then its requested mode is the shared default, auto; an explicit follow_up is kept", async () => {
    const { sdk, store } = fixture()
    expect(await sdk.send({ thread: "my-tui", text: "no mode" })).toMatchObject({ kind: "ok" })
    expect(await sdk.send({ thread: "my-tui", text: "queued on purpose", mode: "follow_up" })).toMatchObject({
      kind: "ok",
    })
    const rows = await store.list({ target_durable_id: "dur-tui" })
    expect(rows.map((row) => [row.body, row.mode_requested])).toEqual([
      ["no mode", "auto"],
      ["queued on purpose", "follow_up"],
    ])
  })
})
