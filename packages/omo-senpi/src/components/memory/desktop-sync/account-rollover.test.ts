import { afterEach, describe, expect, test } from "bun:test"
import { once } from "node:events"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { connect, createServer, Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MessageChannel } from "node:worker_threads"
import { credentialLockPaths } from "@oh-my-opencode/omo-opencode/service-auth"
import type { DeviceAccountSource } from "../device-session/account-source"
import { accountSourceFromSelection } from "../device-session/selected-account-source"
import { attachDesktopSyncChannel } from "./channel"
import { openDesktopSyncAccount, type DesktopSyncEngineWire } from "./desktopSyncAccount"
import type { MemorySyncSelection } from "./hostSelection"
import { serveWorkerPort, workerMemorySyncSource } from "./workerPort"

// #13325: main retires the account on a live private channel (sign-out, then sign-in with the same or another
// account). The `retired` event ends that account; only a closed stream ends the channel, so the engine reaches the
// next account without a restart.

const origin = "https://api.example.test"
const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
})

const descriptor = (account: string) => ({
  genesis: "unsupported",
  rpId: null,
  userName: null,
  serviceOrigin: origin,
  accountId: account,
  serviceDeviceId: `device-${account}`,
  syncPrincipalId: `principal-${account}`,
  publicKeys: { signing: `signing-${account}`, sealing: `sealing-${account}` },
  generation: `generation-${account}`,
  incarnation: `incarnation-${account}`,
})

/** Main behind the desktop bridge: one engine stream, a child per signed-in account, `retired` when it ends. */
async function desktopMain() {
  const home = await mkdtemp(join(tmpdir(), "omo-desktop-rollover-"))
  const paths = credentialLockPaths(origin, home)
  await mkdir(paths.directory, { recursive: true, mode: 0o700 })
  const record = (account: string | null) =>
    writeFile(
      paths.desktopRecord,
      JSON.stringify(
        account === null
          ? {
              version: 1,
              state: "cleared",
              generation: "cleared",
              incarnation: "cleared",
              accountId: null,
              serviceDeviceId: null,
              publicKeys: null,
            }
          : (({ generation, incarnation, accountId, serviceDeviceId, publicKeys }) => ({
              version: 1,
              state: "active",
              generation,
              incarnation,
              accountId,
              serviceDeviceId,
              publicKeys,
            }))(descriptor(account)),
      ),
    )
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("missing test endpoint")
  const accepted = once(server, "connection")
  const engine = connect(address.port, "127.0.0.1")
  const [peer] = await accepted
  server.close()
  if (!(peer instanceof Socket)) throw new Error("missing peer")
  cleanups.push(async () => {
    engine.destroy()
    peer.destroy()
    await rm(home, { recursive: true, force: true })
  })
  let account: string | null = null
  let handles = 0
  const send = (frame: unknown) => peer.write(`${JSON.stringify(frame)}\n`)
  let pending = ""
  peer.setEncoding("utf8")
  peer.on("data", (chunk: string) => {
    pending += chunk
    for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
      const packet = JSON.parse(pending.slice(0, end))
      pending = pending.slice(end + 1)
      if (packet.op === "bootstrap") {
        send({ id: packet.id, ok: true, value: { child: "engine-capability" } })
        continue
      }
      const op = packet.request.op
      if (account === null && op !== "operationCancel" && op !== "operationEnd") {
        send({ id: packet.id, ok: false, reason: "refused" })
        continue
      }
      const value =
        op === "descriptor"
          ? descriptor(account ?? "")
          : op === "operationBegin"
            ? { handle: `handle-${++handles}` }
            : op === "service"
              ? {}
              : null
      send({ id: packet.id, ok: true, value })
    }
  })
  return {
    home,
    engine,
    async signIn(next: string) {
      await record(next)
      account = next
    },
    async signOut() {
      await record(null)
      account = null
      send({ event: "retired", child: "engine-capability" })
    },
  }
}

const cliCanary = (): DeviceAccountSource => {
  throw new Error("the CLI credential source was constructed on a desktop host")
}

async function mainThreadSelection(engine: Socket): Promise<MemorySyncSelection> {
  const attached = await attachDesktopSyncChannel(engine)
  if (attached.kind !== "connected") throw new Error("channel unavailable")
  cleanups.push(() => attached.channel.close())
  return { kind: "desktop", channel: attached.channel }
}

async function workerSelection(engine: Socket): Promise<MemorySyncSelection> {
  const host = mainThreadSelection(engine)
  const { port1, port2 } = new MessageChannel()
  const closed = new AbortController()
  serveWorkerPort(host, port1, closed.signal)
  cleanups.push(() => {
    closed.abort()
    port1.close()
    port2.close()
  })
  return workerMemorySyncSource(port2)
}

const aborted = (signal: AbortSignal) =>
  signal.aborted ? Promise.resolve() : new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()))

describe("an account rollover on a live desktop channel (#13325)", () => {
  for (const [where, select] of [
    ["the main thread", mainThreadSelection],
    ["a session Worker", workerSelection],
  ] as const) {
    for (const [rollover, next] of [
      ["sign-out then sign-in with another account", "account-2"],
      ["sign-out then sign-in with the same account", "account-1"],
    ] as const) {
      test(`${where}: ${rollover} reaches the new account without a restart`, async () => {
        const main = await desktopMain()
        await main.signIn("account-1")
        const selection = await select(main.engine)
        if (selection.kind !== "desktop") throw new Error(`selection ${selection.kind}`)
        const source = accountSourceFromSelection({
          selection: async () => selection,
          cli: cliCanary,
          openAccount: (wire: DesktopSyncEngineWire) => openDesktopSyncAccount(wire, main.home),
        })
        const first = await source()
        if (first === null || first.kind !== "desktop") throw new Error(`first account ${JSON.stringify(first)}`)
        expect(first.descriptor.accountId).toBe("account-1")
        let ended = 0
        first.signal.addEventListener("abort", () => (ended += 1))

        // when: main retires the account and keeps the channel
        await main.signOut()
        await aborted(first.signal)

        // then: the old account ended, the channel did not, and a refused describe reads as no account
        expect(await source().catch(() => null)).toBeNull()
        expect(selection.channel.signal.aborted).toBe(false)
        await main.signIn(next)
        const second = await source()
        if (second === null || second.kind !== "desktop") throw new Error(`second account ${JSON.stringify(second)}`)
        expect(second).not.toBe(first)
        expect(second.descriptor.accountId).toBe(next)
        expect(await second.isCurrent()).toBe(true)
        expect(second.signal.aborted).toBe(false)
        expect(ended).toBe(1)
      })
    }
  }

  test("a closed stream still ends the channel for good", async () => {
    const main = await desktopMain()
    await main.signIn("account-1")
    const selection = await mainThreadSelection(main.engine)
    if (selection.kind !== "desktop") throw new Error(`selection ${selection.kind}`)
    const source = accountSourceFromSelection({
      selection: async () => selection,
      cli: cliCanary,
      openAccount: (wire: DesktopSyncEngineWire) => openDesktopSyncAccount(wire, main.home),
    })
    expect((await source())?.kind).toBe("desktop")
    main.engine.destroy()
    await aborted(selection.channel.signal)
    expect(await source()).toEqual({ kind: "unavailable", reason: "private_channel_unavailable" })
  })
})
