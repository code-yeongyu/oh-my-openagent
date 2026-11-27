import { afterEach, describe, expect, test } from "bun:test"
import { parseAddress } from "@oh-my-opencode/thread-address-core"
import { resolveTypedAddress } from "../../remote/device-address"
import { resolveMember } from "../../remote/resolve"
import { remoteClientOn, sdkOn } from "./testing/entries"
import { ALIAS, B, createTwoDevices, HERE, KEY, NAMES, T, type TwoDeviceOptions } from "./testing/two-devices"

// #14305 AC1/AC2: ONE table over the two-device fixture, run through every surface that reads a typed thread address -
// the thread tools (thread_send), the monitor target, the remote client's sessions.resolve, omo remote's typed address
// and the thread SDK. Each row is an address form (or a miss) and the one outcome every surface must give it: the same
// thread on the same device, or the same refusal code.

type TwoDevices = ReturnType<typeof createTwoDevices>
type Outcome = { readonly thread: string; readonly device: string } | { readonly code: string }
type Surface = (td: TwoDevices, address: string) => Promise<Outcome>

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const threadTools: Surface = async (td, address) => {
  const result = (await td.run("thread_send", { thread: address, message: "x" })) as {
    kind: string
    thread?: string
    device?: string
    error?: { code: string }
  }
  return result.kind === "ok"
    ? { thread: result.thread ?? "", device: result.device ?? HERE.id }
    : { code: result.error?.code ?? result.kind }
}

const monitor: Surface = async (td, address) => {
  const armed = await td.tools.monitorTarget(address)
  if (armed.kind === "refused") return { code: armed.failure.code }
  const target = armed.kind === "target" ? armed.target : address
  const parsed = parseAddress(target)
  return parsed.kind === "device"
    ? { thread: parsed.thread, device: parsed.device }
    : { thread: target, device: HERE.id }
}

const sessionsResolve: Surface = async (td, address) => {
  const resolved = await resolveMember(remoteClientOn(td))(address)
  return resolved.kind === "ok"
    ? { thread: resolved.value.durable_id ?? "", device: resolved.value.device.id }
    : { code: resolved.code }
}

const omoRemote: Surface = async (td, address) => {
  const resolved = await resolveTypedAddress(td.remote, address, { need: "online" })
  return resolved.kind === "ok"
    ? { thread: resolved.thread, device: resolved.where.row.device }
    : { code: resolved.error.code }
}

const threadSdk: Surface = async (td, address) => {
  const located = await sdkOn(td, cleanups).locate({ thread: address })
  if (located.kind !== "ok") return { code: located.error.code }
  const thread = located.thread as { thread_id: string; device?: string }
  return { thread: thread.thread_id, device: thread.device ?? HERE.id }
}

const SURFACES: readonly (readonly [string, Surface])[] = [
  ["thread tools (thread_send)", threadTools],
  ["monitor target", monitor],
  ["remote client sessions.resolve", sessionsResolve],
  ["omo remote", omoRemote],
  ["thread SDK (locate)", threadSdk],
]

const ON_B = { thread: T.bLive, device: B.id } as const

/** One address form or miss, the fixture state it is read in, and the one outcome every surface gives it. */
type Row = {
  readonly form: string
  readonly address: string
  readonly setup?: TwoDeviceOptions
  readonly want: Outcome
}

const ROWS: readonly Row[] = [
  { form: "<device name>/<thread id>", address: `${B.name}/${T.bLive}`, want: ON_B },
  { form: "<device id prefix>/<thread id prefix>", address: `${B.id.slice(0, 6)}/${T.bLive.slice(0, 8)}`, want: ON_B },
  { form: "<device id>/<thread name>", address: `${B.id}/${NAMES.bLive}`, want: ON_B },
  { form: "<device name>/<listing key>", address: `${B.name}/${KEY.bLive}`, want: ON_B },
  { form: "bare thread id", address: T.bLive, want: ON_B },
  { form: "account alias", address: ALIAS.onB, want: ON_B },
  { form: "unique thread name", address: NAMES.bLive, want: ON_B },
  { form: "8+ hex thread id prefix", address: T.bLive.slice(0, 8), want: ON_B },
  {
    form: "ambiguous: a device name two online devices share",
    address: `${B.name}/${T.bLive}`,
    setup: { twin: true },
    want: { code: "ambiguous_target" },
  },
  {
    form: "offline device: a thread part its rows do not hold",
    address: `${B.name}/no-such-thread`,
    setup: { bOffline: true },
    want: { code: "device_offline" },
  },
  {
    form: "unanswered device: a bare name only it holds",
    address: NAMES.bLive,
    setup: { incomplete: true },
    want: { code: "host_unavailable" },
  },
  {
    form: "unanswered device: <device name>/<thread name>",
    address: `${B.name}/${NAMES.bLive}`,
    setup: { incomplete: true },
    want: { code: "host_unavailable" },
  },
  { form: "nowhere: a thread id no device holds", address: T.nowhere, want: { code: "not_found" } },
  { form: "nowhere: a name no device holds", address: "no-such-thread", want: { code: "not_found" } },
]

describe("#14305: one address table through every surface", () => {
  test.each(ROWS.flatMap((row) => SURFACES.map(([surface, read]) => [row.form, surface, row, read] as const)))(
    "#given %s #when %s reads it #then it answers the table's outcome",
    async (_form, _surface, row, read) => {
      const td = createTwoDevices(row.setup)
      cleanups.push(td.cleanup)
      expect(await read(td, row.address)).toEqual(row.want)
    },
  )
})
