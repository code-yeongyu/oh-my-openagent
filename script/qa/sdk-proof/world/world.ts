// The X1a proof's two-device world, from the thread-tools QA kit (packages/omo-senpi/scripts/qa/thread-tools/lib):
//   REAL: this checkout's build, installed into the kit (launcher, plugin, thread SDK, CLI), the released senpi engine the
//         kit pins, and one engine host per device, each with its own HOME and agent dir.
//   FAKE: the model (the kit's fake model on loopback: QA-ACK answers and QA:HOLD turns), the account (two signed-in
//         devices) and the relay (world/fake-relay.ts: device A's device service, forwarding to B's engine host).
// Nothing leaves loopback and no account or credential exists; every wait is bounded and event-driven.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import {
  buildOmoInstall,
  bus,
  cleanupAll,
  ENGINE_VERSION,
  installCleanupHooks,
  makeScratch,
  omo,
  openHostSession,
  startFakeModel,
  startShardHost,
  awaitToolResult,
  type FakeModel,
  type OmoInstall,
  type Scratch,
} from "../../../../packages/omo-senpi/scripts/qa/thread-tools/lib/gateway.mjs"
import type { ToolSession } from "../drivers/tools.ts"
import { METER_MODEL, PARK_TO, parkModelId, SWITCH_TO } from "../scenario.ts"
import { enginePort } from "./engine-port.ts"
import { type Device, type FakeRelay, startFakeRelay } from "./fake-relay.ts"
import { type Observer, observeB } from "./observe.ts"

export const DEVICE_A: Device = { id: "x1a-device-a", name: "x1a-a" }
export const DEVICE_B: Device = { id: "x1a-device-b", name: "x1a-b" }

/** What the run proves about isolation: requests the guard refused, processes it covered, and whether a session bus leaked in. */
export type Isolation = { readonly refused: readonly string[]; readonly guarded: number; readonly sessionBus: boolean }

const GUARD = join(import.meta.dir, "loopback-guard.mjs")
// Slice A1b's account fixture (PR 14996), carried byte-identical: the preload that stands in for the OS credential store
// (a JSON file under the scratch HOME), the keychain helper and the browser opener, and refuses any non-local request.
const ACCOUNT_FIXTURE = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "omo-native",
  "test",
  "account-goldens.fixture.ts",
)
/** The synthetic credential's values: a canary that must appear in no output of the run and nowhere in RESULTS.md. */
export const CANARY = "x1a-canary-credential"
// No account service answers here (a discard port on loopback): a CLI call that needed one fails in the world.
const ACCOUNT_ORIGIN = "http://127.0.0.1:9"

// Device A's CLI signed in: a store seeded with the canary credential of device A, read through the A1b preload, which
// every bun process the CLI starts loads (BUN_OPTIONS); never the machine's keyring, which the world cannot reach.
const signedIn = (a: Scratch): { readonly env: Record<string, string>; readonly refused: string } => {
  const store = join(a.home, ".golden-store.json")
  const credential = {
    accessToken: `${CANARY}-access`,
    accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    refreshToken: `${CANARY}-refresh`,
    offlineGrant: `${CANARY}-grant`,
    device: { id: DEVICE_A.id, name: DEVICE_A.name },
    signingPrivateKey: `${CANARY}-signing`,
    sealingPrivateKey: `${CANARY}-sealing`,
  }
  writeFileSync(store, JSON.stringify({ "*": JSON.stringify(credential) }))
  const runtime = join(a.home, "xdg-run")
  mkdirSync(runtime, { recursive: true })
  const env = {
    ...a.env,
    BUN_OPTIONS: `${a.env["BUN_OPTIONS"] ?? ""} --preload ${ACCOUNT_FIXTURE}`.trim(),
    GOLDEN_STORE_FILE: store,
    GOLDEN_ACCOUNTS: "open",
    GOLDEN_HELPER: "ready",
    OMO_TEST_CREDENTIAL_LOCK_HOME: a.home,
    OMO_RUNTIME: "bun",
    OMO_SERVICE_API_URL: ACCOUNT_ORIGIN,
    OMO_SERVICE_ACCOUNTS_URL: ACCOUNT_ORIGIN,
    XDG_RUNTIME_DIR: runtime,
    NO_PROXY: "127.0.0.1",
  }
  return { env, refused: join(a.home, ".golden-refused") }
}

// Fail closed: every process of the device loads the loopback guard, and the environment carries no session bus, so a
// keyring or secret service of the machine running the proof is out of reach (only the world's own files are).
const isolate = (scratch: Scratch): { readonly refused: string; readonly guarded: string } => {
  const refused = join(scratch.dir, "x1a-refused.log")
  const guarded = join(scratch.dir, "x1a-guard.log")
  writeFileSync(refused, "")
  writeFileSync(guarded, "")
  const tmp = join(scratch.dir, "tmp")
  mkdirSync(tmp, { recursive: true })
  delete scratch.env["DBUS_SESSION_BUS_ADDRESS"]
  Object.assign(scratch.env, {
    TMPDIR: tmp,
    X1A_REFUSED_FILE: refused,
    X1A_GUARD_LOG: guarded,
    NODE_OPTIONS: `--import ${pathToFileURL(GUARD).href}`,
    BUN_OPTIONS: `--preload ${GUARD}`,
  })
  return { refused, guarded }
}

const linesOf = (path: string): string[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")

export type World = {
  readonly engine: string
  /** Whether the world carries a signed-in account (the CLI's omo remote verbs read it). */
  readonly account: boolean
  /** Device A's environment for the CLI: A's own plus the signed-in account. */
  readonly cliEnv: Record<string, string>
  readonly install: OmoInstall
  readonly a: Scratch
  readonly relay: FakeRelay
  readonly observer: Observer
  readonly fake: FakeModel
  /**
   * Releases a held turn, and keeps it released: a later request quoting that hold (B's compaction summarizing the
   * transcript) would otherwise be held again on the same tag, with no step left to release it.
   */
  readonly release: (tag: string) => void
  readonly toolSession: () => Promise<ToolSession>
  readonly roots: readonly string[]
  /** Read before close: the scratch directories holding the guard's records go with the world. */
  readonly isolation: () => Isolation
  /** Each environment the world runs processes with, and the scratch directory its writes must stay in. */
  readonly writeEnvs: readonly { readonly name: string; readonly env: Record<string, string>; readonly root: string }[]
  readonly close: () => Promise<void>
}

// B's catalog gains a model that reasons, so the switch with a thinking suffix has a level to apply (#14939).
const addThinkingModel = (agentDir: string): void => {
  const path = join(agentDir, "models.json")
  const models = JSON.parse(readFileSync(path, "utf8"))
  const mock = models.providers.mock
  mock.models.push({ ...mock.models[0], id: SWITCH_TO.id, reasoning: true })
  for (let window = PARK_TO.windows.from; window <= PARK_TO.windows.to; window += PARK_TO.windows.step)
    mock.models.push({ ...mock.models[0], id: parkModelId(window), reasoning: true, contextWindow: window })
  mock.models.push({ ...mock.models[0], id: METER_MODEL, contextWindow: 256 })
  writeFileSync(path, `${JSON.stringify(models, null, 2)}\n`)
}

export async function startWorld(trace: (line: string) => void): Promise<World> {
  installCleanupHooks()
  const install = await buildOmoInstall("x1a-proof")
  // The model reports usage the way a real provider does (about four characters a token over the whole request), so B's
  // context estimate follows the thread and a switch can need a compaction (the parked step, #14939).
  const fake = await startFakeModel({ promptTokens: (body) => Math.ceil(JSON.stringify(body).length / 4) })
  const released = new Set<string>()
  const rerelease = (): void => {
    for (const tag of fake.heldTags()) if (released.has(tag)) fake.release(tag)
  }
  bus.on("tick", rerelease)
  const a = makeScratch("x1a-a", fake)
  const b = makeScratch("x1a-b", fake)
  addThinkingModel(b.agentDir)
  const guards = [isolate(a), isolate(b)]
  const hostB = await startShardHost(b, install, "x1a-b")
  const relayDir = join(a.dir, "ds")
  mkdirSync(relayDir, { recursive: true })
  const relay = await startFakeRelay({
    here: DEVICE_A,
    peer: DEVICE_B,
    engine: await enginePort(hostB.socket),
    trace,
    stateDir: relayDir,
  })
  a.env["OMO_DEVICE_SERVICE_STATE_DIR"] = relay.stateDir
  const account = signedIn(a)
  // Device A's own engine host (its operator endpoint, rpc.sock), as a signed-in device runs it: a create or a send
  // from A asks it first, whichever device the thread lands on.
  const daemonA = await omo(a, install, ["daemon", "run", "--json"])
  if (daemonA.code !== 0)
    throw new Error(`device A's daemon did not start (${daemonA.code}): ${daemonA.stderr.slice(-800)}`)
  const observer = await observeB(hostB.socket, () => fake.heldTags())
  let session: ToolSession | undefined
  const toolSession = async (): Promise<ToolSession> => {
    if (session !== undefined) return session
    const hostA = await startShardHost(a, install, "x1a-a")
    const opened = await openHostSession(hostA.client, a.work)
    session = {
      prompt: async (text, tool) => {
        const from = fake.requests.length
        await hostA.client.request({ type: "prompt", sessionId: opened.routingId, message: text })
        return JSON.stringify(await awaitToolResult(fake, tool, from, { timeoutMs: 120_000 }))
      },
    }
    return session
  }
  return {
    engine: ENGINE_VERSION,
    account: true,
    cliEnv: account.env,
    writeEnvs: [
      { name: "device A", env: a.env, root: a.dir },
      { name: "device B", env: b.env, root: b.dir },
      { name: "device A's CLI", env: account.env, root: a.dir },
    ],
    install,
    a,
    relay,
    observer,
    fake,
    release: (tag) => {
      released.add(tag)
      fake.release(tag)
    },
    toolSession,
    roots: [a.dir, b.dir, relay.stateDir, install.root],
    isolation: () => ({
      refused: [
        ...guards.flatMap((guard) => linesOf(guard.refused)),
        ...(existsSync(account.refused) ? linesOf(account.refused) : []),
      ],
      guarded: guards.reduce((sum, guard) => sum + linesOf(guard.guarded).length, 0),
      sessionBus: [a, b].some((scratch) => scratch.env["DBUS_SESSION_BUS_ADDRESS"] !== undefined),
    }),
    close: async () => {
      bus.off("tick", rerelease)
      observer.close()
      await relay.stop()
      await cleanupAll()
    },
  }
}
