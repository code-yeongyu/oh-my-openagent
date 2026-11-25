import type {
  RemoteSessionRow,
  RemoteThreadSurface,
} from "../../../packages/omo-senpi/src/components/thread/remote/ports"
import { createRemoteThreadFixture } from "../../../packages/omo-senpi/src/components/thread/thread-remote-fixture"
import type { Recorder } from "./recorder"

// The thread core's cross-device port (RemoteThreadSurface) over the remote fixture's account, every member it reaches
// recorded in the table's vocabulary. The account holds one other device, "studio" (the fixture's device b), running
// thread t-2; a thread there is
// named in the trace by its address `studio/<durable id>`. An engine record sent to a device is named by its `type`
// (set_session_name is sessions.rename); a record with no port operation is refused loudly. Reads of the connection's
// own state (service status, this device, capabilities) carry no operation of the table and pass through unrecorded.

export const STUDIO = { id: "b", label: "studio" } as const
export const STUDIO_THREAD = "t-2"

const RPC_OPS: Readonly<Record<string, string>> = {
  set_session_name: "sessions.rename",
  prompt: "sessions.send",
  admit_external_message: "sessions.send",
  abort: "sessions.interrupt",
  interrupt: "sessions.interrupt",
  get_state: "sessions.get",
  get_protocol_info: "sessions.get",
  get_messages: "sessions.read",
  get_entries: "sessions.read",
  open_session: "sessions.open",
  list_sessions: "sessions.list",
  find_session: "sessions.resolve",
  set_model: "sessions.setModel",
  set_thinking_level: "sessions.setReasoning",
  close_session: "sessions.close",
  unload_session: "sessions.close",
  set_session_archived: "sessions.archive",
}

type Fn = (...args: never[]) => unknown

export function remotePort(recorder: Recorder): {
  readonly remote: RemoteThreadSurface
  readonly dispose: () => Promise<void>
} {
  const given = recorder.given("remote")
  const online = !(given["device"] === STUDIO.label && given["online"] === false)
  const row: RemoteSessionRow = {
    device: STUDIO.id,
    session_id: STUDIO_THREAD,
    durable_id: STUDIO_THREAD,
    title: `lane ${STUDIO_THREAD}`,
    project: "/work/studio",
    path: "/work/studio",
    state: "idle",
    updated_ms: 1_700_000_000_000,
  }
  const fixture = createRemoteThreadFixture()
  const { remote } = fixture.account({ rows: [row], online, live: [STUDIO_THREAD] })
  const label = (device: unknown): string => (device === STUDIO.id ? STUDIO.label : String(device))
  const address = (device: unknown, session: unknown): string => `${label(device)}/${String(session)}`
  const refusalOf = (result: unknown): string | undefined => {
    const code = Reflect.get(Object(result), "code")
    return typeof code === "string" ? code : undefined
  }
  const rpcOp = (rpc: unknown): string => {
    const type = String(Reflect.get(Object(rpc), "type"))
    const op = RPC_OPS[type]
    if (op === undefined) throw new Error(`fake remote: engine record ${type} has no port operation`)
    return op
  }
  const wrap = <T extends object>(
    target: T,
    ops: Readonly<Record<string, (...args: never[]) => [string, Record<string, unknown>]>>,
    refused: (code: string) => unknown,
  ): T =>
    new Proxy(target, {
      get: (object, key, receiver) => {
        const value = Reflect.get(object, key, receiver) as unknown
        const named = typeof key === "string" ? ops[key] : undefined
        if (typeof value !== "function" || named === undefined) return value
        return async (...args: never[]) => {
          const [op, recorded] = named(...args)
          const code = refusalOf(recorder.record("remote", op, recorded).result)
          return code === undefined ? await (value as Fn).apply(object, args) : refused(code)
        }
      },
    })
  const deviceFilter = (filter?: { readonly device?: string }): [string, Record<string, unknown>] => [
    "sessions.list",
    filter?.device === undefined ? {} : { device: label(filter.device) },
  ]
  const commandRefusal = (code: string) => ({ kind: "refused", reason: code })
  const sessions = wrap(
    remote.sessions,
    {
      sessions: deviceFilter,
      listing: deviceFilter,
      devices: () => ["devices.list", {}],
      endpointCommand: (device: string, rpc: object) => [rpcOp(rpc), { device: label(device) }],
      sessionCommand: (device: string, session: string, rpc: object) => [
        rpcOp(rpc),
        {
          thread: address(device, session),
          ...(Reflect.get(rpc, "name") === undefined ? {} : { name: Reflect.get(rpc, "name") }),
        },
      ],
      read: (device: string, session: string) => ["sessions.read", { thread: address(device, session) }],
      locate: (device: string, engineId: string) => ["sessions.resolve", { thread: address(device, engineId) }],
      lookup: (device: string, durableId: string) => ["sessions.resolve", { thread: address(device, durableId) }],
      watch: (device: string, session: string) => ["sessions.follow", { thread: address(device, session) }],
      wake: (device: string, durableId: string) => ["sessions.send", { thread: address(device, durableId) }],
    },
    commandRefusal,
  )
  const aliasError = (code: string) => ({ kind: "error", error: { code, message: `fake alias registry: ${code}` } })
  const aliases =
    remote.aliases === undefined
      ? undefined
      : wrap(
          remote.aliases,
          {
            claim: (input: { alias: string; holder: { session_id: string } }) => [
              "aliases.set",
              { thread: input.holder.session_id, alias: input.alias },
            ],
            rename: (input: { session_id: string; to: string }) => [
              "aliases.set",
              { thread: input.session_id, alias: input.to },
            ],
            release: (input: { session_id: string; alias: string }) => [
              "aliases.clear",
              { thread: input.session_id, alias: input.alias },
            ],
            resolve: (alias: string) => ["aliases.resolve", { alias }],
            aliasesOf: (ids: readonly string[]) => ["aliases.resolve", { threads: ids }],
          },
          aliasError,
        )
  const clientSessions = wrap(
    remote.client.sessions,
    Object.fromEntries(
      Object.keys(remote.client.sessions).map((name) => [
        name,
        (first: unknown, second: unknown) => [
          `sessions.${name}`,
          name === "resolve" ? { address: first, ...(second === undefined ? {} : { scope: second }) } : {},
        ],
      ]),
    ),
    (code: string) => ({ kind: "error", error: { code, message: `fake remote client: ${code}` } }),
  )
  const clientDevices = wrap(
    remote.client.devices,
    { list: () => ["devices.list", {}], resolve: (idOrName: string) => ["devices.resolve", { device: idOrName }] },
    (code: string) => ({ kind: "error", error: { code, message: `fake remote client: ${code}` } }),
  )
  return {
    remote: {
      ...remote,
      sessions,
      ...(aliases === undefined ? {} : { aliases }),
      client: { ...remote.client, sessions: clientSessions, devices: clientDevices },
    },
    dispose: fixture.cleanup,
  }
}
