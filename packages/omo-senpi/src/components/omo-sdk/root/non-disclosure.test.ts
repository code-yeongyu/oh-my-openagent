import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sampleOf } from "../../../../test-support/omo-sdk-sample-input"
import { type OmoPrincipal, ROOT_CALLS, type RootCallKey } from "../contract"
import { inputAccepts } from "../contract/validate"
import type { OmoSdkPorts } from "../options"
import { assembleOmoSdk } from "../assembly"
import { createGatewayStore, type GatewayStore } from "../../thread/gateway/store"
import type { RemoteThreadSurface } from "../../thread/remote/ports"
import type { TableScenario } from "../../../../../../script/sdk-parity/expectation"
import { createRecorder } from "../../../../../../script/sdk-parity/fakes/recorder"
import { remotePort } from "../../../../../../script/sdk-parity/fakes/remote"
import type { ThreadHost } from "../../thread/tools"
import { createThreadSdk } from "../../thread/sdk"
import { startFakeOwner } from "../../../../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld } from "../../../../../device-service-core/test/local-api/conformance/world.ts"
import { invalidInput } from "./assemble"
import { boundaryRefusals } from "./authority"

// Security design 6, for the whole root (P1b's share): fake ports hold one canary per asset of 2.1; every call of the
// root type runs through its ok path or its answer as built, a refusal for each refused principal kind and one injected
// fault; the returned value, the failure, every stream event, every exception's message and stack, everything written
// to the console and every file the call wrote under the run's home and agent dir are scanned. Nothing of a canary may
// appear outside its row's destination; the scan of the root's result objects alone is not the I1 evidence, which is
// why the store, the console and the files are scanned too. The negative control proves the scanner finds a canary.
// The rule, in its order (LEAD ruling on design 4.5): FIRST, no answer for any principal carries secret contents (keys,
// tokens, dial secrets, credentials); SECOND, the script answer is what any caller can get, since an agent session that
// builds its own root in an eval cell is a script (4.5), so its paths are the caller's own files at declared locations;
// THIRD, a root built with a session or a service principal gets less, per the matrix. A 'refused to a session' cell
// holds for a root built with that principal, never for a session's own eval-cell root.
// devices.list reads this machine's device service (omo#14881): the conformance owner serves a roster whose rows carry a
// field the listing must drop, holding a canary, so the scan proves the mapping and not an empty answer.
const ROSTER_CANARY_FIELD = "token"
async function rosterService(
  canary: string,
): Promise<{ readonly stateDir: string; readonly stop: () => Promise<void> }> {
  const stateDir = mkdtempSync(join(tmpdir(), "la-"))
  const world = defaultWorld()
  const owner = await startFakeOwner({
    stateDir,
    world: {
      ...world,
      devices: world.devices.map((device) => ({ ...device, [ROSTER_CANARY_FIELD]: canary })),
    } as never,
    // The device service is reached through its state dir, not a port object: its roster request is the call's touch.
    onRequest: (type) => {
      if (type === "devices.list" && running !== undefined)
        touches.push({ key: running, port: "deviceService.devices.list" })
    },
  })
  return {
    stateDir,
    stop: async () => {
      await owner.stop()
      rmSync(stateDir, { recursive: true, force: true })
    },
  }
}

const CANARIES = {
  accessToken: "CANARY-access-6f1e",
  refreshToken: "CANARY-refresh-91ad",
  privateKey: "CANARY-privkey",
  recoveryPhrase: "CANARY-phrase-b2d4",
  providerKey: "CANARY-provider-58e0",
  oauthToken: "CANARY-oauth-a7c9",
  socketSecret: "CANARY-socket-0d36",
  userCode: "CANARY-usercode-e4b1",
} as const

const CANARY_VALUES: readonly string[] = Object.values(CANARIES)
// Planted by the driver in every free string field a caller supplies. Echoed to the caller who sent it, it is pinned by
// call below; it must never reach the console or a written file.
const INPUT_CANARY = "CANARY-input-7b52"

/** Every place a canary is found in a value, by path; strings, keys, nested objects, arrays and errors are walked. */
function canariesIn(
  value: unknown,
  path = "$",
  seen = new Set<unknown>(),
  canaries: readonly string[] = CANARY_VALUES,
): string[] {
  if (typeof value === "string")
    return canaries.filter((canary) => value.includes(canary)).map((canary) => `${path}: ${canary}`)
  if (typeof value !== "object" || value === null || seen.has(value)) return []
  seen.add(value)
  const own = value instanceof Error ? { message: value.message, stack: value.stack, cause: value.cause } : value
  return Object.entries(own).flatMap(([key, child]) => [
    ...canariesIn(key, `${path}[key]`, seen, canaries),
    ...canariesIn(child, `${path}.${key}`, seen, canaries),
  ])
}

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

// The gateway store is read column by column, not as bytes (design lane ruling): a caller's input may sit in exactly one
// place, the delivery payload of a send (deliveries.body, the store of record for a message that must be delivered);
// an asset canary sits nowhere. Its WAL and shared-memory files are read through the database, not searched as bytes.
const GATEWAY_STORE = "gateway.sqlite"
const INPUT_ALLOWED_IN_STORE = ["deliveries.body"] as const

function storeColumnsHolding(path: string, canaries: readonly string[]): string[] {
  // Read-write, though it only reads: a read-only connection cannot create the WAL index (-shm) the writer removed on
  // close, so on macOS it fails with SQLITE_CANTOPEN; only SELECTs run below.
  const db = new Database(path)
  try {
    const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    return tables.flatMap(({ name }) => {
      const rows = db.query(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all() as Record<string, unknown>[]
      const columns = new Set<string>()
      for (const row of rows)
        for (const [column, value] of Object.entries(row))
          if (
            canaries.some((canary) =>
              String(value instanceof Uint8Array ? Buffer.from(value).toString("latin1") : value).includes(canary),
            )
          )
            columns.add(`${name}.${column}`)
      return [...columns]
    })
  } finally {
    db.close()
  }
}

const isStoreFile = (path: string) => /gateway\.sqlite(-wal|-shm)?$/.test(path)

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

const failing = (asset: string) => async (): Promise<never> => {
  throw new Error(`port failed while holding ${asset}`)
}

function canaryHost(fault: boolean): ThreadHost {
  const reject = failing(CANARIES.socketSecret)
  return {
    socket: `/tmp/${CANARIES.socketSecret}.sock`,
    listSessions: fault ? reject : async () => [],
    listView: fault ? reject : async () => ({ sessions: [], hosts: [], disk: [] }),
    openSession: reject,
    getMessages: reject,
    getState: reject,
    prompt: reject,
    interrupt: reject,
    setSessionName: reject,
    setModel: reject,
    getAvailableModels: reject,
    setThinkingLevel: reject,
    getAvailableThinkingLevels: reject,
    gateway: { wake: async () => ({ admitted: [] }), releaseSession: reject },
  }
}

function faultingStore(): GatewayStore {
  const fails = failing(CANARIES.socketSecret)
  return new Proxy({} as GatewayStore, {
    get: (_target, name) => (name === "dispose" ? async () => undefined : name === "then" ? undefined : fails),
  })
}

// The scan runs only on fakes (design lane ruling after a default port reached a real keychain helper): every port the
// root takes is listed here, the type forces the list to name every port, and the scan fails by name before any call
// when one is missing or not a registered fake. A slice that adds calls with new ports adds their fakes here.
const FAKES = new WeakSet<object>()
const fake = <T extends object>(port: T): T => {
  FAKES.add(port)
  return port
}
const PORT_NAMES = {
  session: true,
  credentialStore: true,
  desktopLaunch: true,
  host: true,
  store: true,
  remote: true,
  now: true,
  deviceServiceStatus: true,
  signInProcess: true,
  remoteTimers: true,
} as const satisfies Record<keyof OmoSdkPorts, true>

function notFake(ports: OmoSdkPorts): string[] {
  return Object.keys(PORT_NAMES).filter((name) => {
    const port: unknown = Reflect.get(ports, name)
    return typeof port !== "object" && typeof port !== "function" ? true : port === null || !FAKES.has(port)
  })
}

// A remote surface whose every operation fails (or, healthy, answers nothing), at any depth; closing it is quiet.
function fakeRemote(fault: boolean): unknown {
  const node = (): unknown =>
    new Proxy(function () {}, {
      get: (_target, name) => (name === "then" ? undefined : name === "close" ? async () => undefined : node()),
      apply: () => (fault ? failing(CANARIES.socketSecret)() : Promise.resolve(undefined)),
    })
  return node()
}

// Healthy, the remote answers as the real one does from the scenario drivers' fake (a device listing other threads), so
// a thread the caller names that no device lists reaches the core's not-found answer.
function listingRemote(): RemoteThreadSurface {
  const scenario = { id: "scan/listing", row: "threads.list", kind: "effect", input: {}, expect: [] } as TableScenario
  return remotePort(createRecorder(scenario)).remote
}

// The id a rename just sent: only its own read-back lists it, so no later call sees another caller's input.
let renamedId: string | undefined
async function healthyAccountService(path: string, init?: { readonly method?: string }): Promise<unknown> {
  if (path === "/v1/me")
    return { user: { email: "owner@example.test", token: CANARIES.oauthToken }, account: { id: "acct-1" } }
  if (path === "/v1/devices") {
    const id = renamedId ?? "dev-2"
    renamedId = undefined
    return {
      devices: [
        { id: "dev-1", name: "laptop", current: true, revokedAt: null, token: CANARIES.oauthToken },
        { id, name: "studio", revokedAt: null, secret: CANARIES.refreshToken },
      ],
    }
  }
  if (init?.method === "PATCH") {
    const id = decodeURIComponent(path.slice("/v1/devices/".length))
    renamedId = id
    return { id, name: "studio", revokedAt: null, token: CANARIES.oauthToken }
  }
  return { token: CANARIES.oauthToken }
}

// Healthy: the code event shows the user code (by design only to onUserCode), then the device is signed in.
const healthySignIn: NonNullable<OmoSdkPorts["signInProcess"]> = async ({ onLine }) => {
  onLine(
    JSON.stringify({
      event: "code",
      verificationUri: "https://accounts.example.test/device",
      userCode: CANARIES.userCode,
      matchingCode: "MATCH-1",
      expiresAt: "2099-01-01T00:00:00Z",
    }),
  )
  onLine(
    JSON.stringify({
      event: "signed_in",
      device: { id: "dev-9", name: "new" },
      deviceService: "on",
      token: CANARIES.oauthToken,
    }),
  )
  return { code: 0 }
}

function canaryPorts(fault: boolean, home: string): OmoSdkPorts {
  return withFakes(fault, home, {
    desktopLaunch: () => false,
    credentialStore: {
      read: fault
        ? failing(CANARIES.refreshToken)
        : async () =>
            ({
              device: { id: "dev-1", name: "laptop" },
              accessToken: CANARIES.accessToken,
              refreshToken: CANARIES.refreshToken,
              privateKey: CANARIES.privateKey,
            }) as never,
    },
    session: {
      accessToken: async () => CANARIES.accessToken,
      // Healthy: each path gives the answer its call carries data from, with a canary in a field the answer must drop.
      request: fault ? failing(CANARIES.oauthToken) : healthyAccountService,
    },
    deviceServiceStatus: fault ? failing(CANARIES.providerKey) : async () => "not_running",
    signInProcess: fault ? (failing(CANARIES.userCode) as never) : healthySignIn,
    host: canaryHost(fault),
    // With ports faulting the gateway store faults too; healthy, it is a store the scan builds in its own scratch agent
    // dir, so its file is read column by column.
    store: fault ? faultingStore() : createGatewayStore({ agentDir: home }),
    remote: fault ? (fakeRemote(true) as RemoteThreadSurface) : listingRemote(),
    now: () => 1_764_000_000_000,
    // devices.list's clock: real deadlines, so a device service that never answers still settles.
    remoteTimers: {
      after: (ms: number, fn: () => void) => {
        const timer = setTimeout(fn, ms)
        return () => clearTimeout(timer)
      },
      now: () => Date.now(),
    },
  })
}

function scanPorts(fault: boolean, home: string): OmoSdkPorts {
  const ports = canaryPorts(fault, home)
  const missing = notFake(ports)
  if (missing.length > 0)
    throw new Error(
      `the scan runs only on fake ports; not a fake: ${missing.join(", ")} (add the fake for every port a call uses)`,
    )
  return ports
}

function withFakes(_fault: boolean, _home: string, ports: OmoSdkPorts): OmoSdkPorts {
  for (const port of Object.values(ports)) if (typeof port === "object" || typeof port === "function") fake(port)
  return ports
}

const PRINCIPALS = [
  undefined,
  { kind: "person", uid: 501 },
  { kind: "session", session_id: "s-1" },
  { kind: "connector", binding: "b-1" },
  { kind: "service" },
] as const

type Captured = { readonly key: RootCallKey; readonly answer: unknown }

// Which port each call touched (reach by case, design lane ruling): every port function is wrapped to record the call
// running when it was invoked.
let running: RootCallKey | undefined
const touches: { readonly key: RootCallKey; readonly port: string }[] = []
function recorded<T>(value: T, port: string): T {
  if ((typeof value !== "object" && typeof value !== "function") || value === null || Array.isArray(value)) return value
  return new Proxy(value as object, {
    apply: (target, self, args) => {
      if (running !== undefined) touches.push({ key: running, port })
      return Reflect.apply(target as (...inner: unknown[]) => unknown, self, args)
    },
    get: (target, name, receiver) =>
      typeof name === "symbol" || name === "then"
        ? Reflect.get(target, name, receiver)
        : recorded(Reflect.get(target, name, receiver), `${port}.${name}`),
  }) as T
}

// The pure calls (the registry's closed list): they touch no port.
const ROWS_DIR = join(import.meta.dir, "../../../../../../script/sdk-parity/rows")
const PURE_CALLS = new Set(
  readdirSync(ROWS_DIR)
    .filter((name) => name.endsWith(".json"))
    .flatMap(
      (name) =>
        (JSON.parse(readFileSync(join(ROWS_DIR, name), "utf8")) as { rows: { sdk?: string; pure?: true }[] }).rows,
    )
    .filter((row) => row.pure === true && row.sdk !== undefined)
    .map((row) => row.sdk as string),
)

// The ONE named, counted exception (B8, carried by slice T1b's PR 15000): the thread core's thrown() (thread/sdk-core/
// failures.ts) answers internal_error with the unexpected exception's message in its own message, as every shipped thread
// surface does today. It is admitted only there; once B8 removes the echo the count is 0 and this test fails, so T1b's
// change deletes the entry and the scan is fully strict.
const B8_ECHO = { code: "internal_error", prefix: "Thread operation failed: " } as const

function isB8Echo(entry: Captured): boolean {
  if (!entry.key.startsWith("threads.")) return false
  const error = (entry.answer as { readonly error?: { readonly code?: unknown; readonly message?: unknown } }).error
  return error?.code === B8_ECHO.code && typeof error.message === "string" && error.message.startsWith(B8_ECHO.prefix)
}

// Each call runs twice: with every optional field, and with the required ones only, so an optional field this release
// does not build (answered not_implemented before any port) cannot hide the core behind it.
async function drive(key: RootCallKey, member: unknown, captured: Captured[]): Promise<void> {
  for (const optional of [true, false])
    await driveOnce(key, member, captured, sampleOf(ROOT_CALLS[key].input as never, INPUT_CANARY, "", optional))
}

async function driveOnce(key: RootCallKey, member: unknown, captured: Captured[], input: unknown): Promise<void> {
  running = key
  try {
    const answer = (member as (input: unknown, options: unknown) => unknown)(input, { deadline_ms: 5 })
    if (typeof answer === "object" && answer !== null && Symbol.asyncIterator in answer) {
      for await (const event of answer as AsyncIterable<unknown>) captured.push({ key, answer: event })
      return
    }
    captured.push({ key, answer: await answer })
  } catch (error) {
    captured.push({ key, answer: error })
  } finally {
    running = undefined
  }
}

// Where the B8 echo is expected today: the thread calls that reach a faulting host for a principal the root serves.
const EXPECTED_B8_ECHO: Readonly<Record<"ok" | "fault", Readonly<Record<string, readonly string[]>>>> = {
  ok: {},
  fault: {
    script: [
      "threads.list",
      "threads.read",
      "threads.locate",
      "threads.send",
      "threads.create",
      "threads.interrupt",
      "threads.close",
      "threads.release",
      "threads.setModel",
      "threads.rename",
    ],
    person: [
      "threads.list",
      "threads.read",
      "threads.locate",
      "threads.send",
      "threads.create",
      "threads.interrupt",
      "threads.close",
      "threads.release",
      "threads.setModel",
      "threads.rename",
    ],
  },
}

// Built, permitted calls that answer without touching a port, with every port faulting (observed; each with its reason).
// Permitted, built calls that still answer without a port: GAPS, each with the slice that gives the call its port. The
// list is closed and self-retiring: once the call touches a port, the exact-list check below fails until its entry is
// removed. config.status reads the config files under the home directly; daemon.warm opens the daemon's socket directly.
const PORT_GAPS: readonly {
  readonly call: RootCallKey
  readonly principals: readonly string[]
  readonly owner: string
}[] = [
  { call: "config.status", principals: ["script", "person", "session", "service"], owner: "C1b" },
  { call: "daemon.warm", principals: ["script", "person"], owner: "C1a" },
]
const ANSWERED_WITHOUT_A_PORT: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  ["script", "person", "session", "connector", "service"].map((kind) => [
    kind,
    PORT_GAPS.filter((gap) => gap.principals.includes(kind)).map((gap) => gap.call),
  ]),
)

// The healthy pass, per built call admitted for a principal (design lane ruling, t72y's form): the answer KIND for each of
// the two driver inputs, the call's OWN port family where it has one (reading the credential store first is the account
// precondition, never the call's port), and whether its answer's CONTENT was scanned: `scanned: false` means the healthy
// answer is a typed refusal only because the fixture holds nothing to answer with, or the call has no member yet, so no
// data-carrying answer of it passed the scan. Each such row names the slice that clears it and is self-retiring: a
// `scanned: false` row whose call answers ok is stale and fails. A boundary refusal or an unbuilt call is judged above.
const NO_THREAD = "the scan's fake host holds no thread (and no extension) with the sample ids"
type HealthyRow = {
  readonly kinds: Readonly<Partial<Record<string, readonly string[]>>>
  readonly port?: string
  readonly scanned: boolean
  readonly owner?: string
  readonly reason?: string
}
const HEALTHY: Readonly<Record<string, HealthyRow>> = {
  "account.devices": {
    kinds: { script: ["ok"], person: ["ok"], session: ["ok"] },
    port: "ports.session",
    scanned: true,
  },
  "account.signIn": {
    kinds: { script: ["not_implemented", "ok"], person: ["not_implemented", "ok"], session: ["not_implemented", "ok"] },
    port: "ports.signInProcess",
    scanned: true,
  },
  "account.whoami": {
    kinds: { script: ["ok"], person: ["ok"], session: ["ok"] },
    port: "ports.session",
    scanned: true,
  },
  "config.status": {
    kinds: { script: ["ok"], person: ["ok"], session: ["ok"], service: ["ok"] },
    scanned: true,
    owner: "C1b",
    reason: "answers with no port (PORT_GAPS)",
  },
  "daemon.warm": { kinds: { script: ["not_implemented", "ok"], person: ["not_implemented", "ok"] }, scanned: true },
  "deviceService.status": {
    kinds: { script: ["ok"], person: ["ok"], session: ["ok"], connector: ["ok"], service: ["ok"] },
    port: "ports.deviceServiceStatus",
    scanned: true,
  },
  "devices.list": { kinds: { script: ["ok"], person: ["ok"], session: ["ok"] }, port: "deviceService", scanned: true },
  "devices.rename": {
    kinds: { script: ["ok"], person: ["ok"], session: ["ok"] },
    port: "ports.session",
    scanned: true,
  },
  "threads.close": {
    kinds: { script: ["caller_context_missing", "not_found"], person: ["caller_context_missing", "not_found"] },
    scanned: false,
    owner: "T1a",
    reason: NO_THREAD,
  },
  "threads.create": {
    kinds: { script: ["invalid_arguments", "not_implemented"], person: ["invalid_arguments", "not_implemented"] },
    scanned: false,
    owner: "T1b",
    reason: NO_THREAD,
  },
  "threads.extensions.call": {
    kinds: { script: ["not_found"], person: ["not_found"] },
    scanned: false,
    owner: "T1a",
    reason: NO_THREAD,
  },
  "threads.extensions.register": {
    kinds: { script: ["invalid_arguments"], person: ["invalid_arguments"] },
    scanned: false,
    owner: "T1a",
    reason: NO_THREAD,
  },
  "threads.interrupt": {
    kinds: { script: ["not_found"], person: ["not_found"] },
    scanned: false,
    owner: "T1a",
    reason: NO_THREAD,
  },
  "threads.list": { kinds: { script: ["not_implemented", "ok"], person: ["not_implemented", "ok"] }, scanned: true },
  "threads.locate": {
    kinds: { script: ["not_found"], person: ["not_found"] },
    scanned: false,
    owner: "T1a",
    reason: NO_THREAD,
  },
  "threads.read": {
    kinds: { script: ["not_found", "not_implemented"], person: ["not_found", "not_implemented"] },
    scanned: false,
    owner: "T1a",
    reason: NO_THREAD,
  },
  "threads.release": {
    kinds: { script: ["not_found", "not_implemented"], person: ["not_found", "not_implemented"] },
    scanned: false,
    owner: "T1a",
    reason: NO_THREAD,
  },
  "threads.rename": {
    kinds: { script: ["invalid_arguments", "not_found"], person: ["invalid_arguments", "not_found"] },
    scanned: false,
    owner: "T1a",
    reason: NO_THREAD,
  },
  "threads.send": {
    kinds: { script: ["invalid_arguments", "not_found"], person: ["invalid_arguments", "not_found"] },
    scanned: false,
    owner: "T1a",
    reason: NO_THREAD,
  },
  "threads.setModel": {
    kinds: { script: ["not_found"], person: ["not_found"] },
    scanned: false,
    owner: "T1a",
    reason: NO_THREAD,
  },
}

// Where a caller's own input comes back in the answer to that caller, as observed (reported to the design lane).
const EXPECTED_INPUT_ECHO: Readonly<Record<"ok" | "fault", Readonly<Record<string, readonly string[]>>>> = {
  ok: {
    script: [
      "threads.read",
      "threads.locate",
      "threads.send",
      "threads.interrupt",
      "threads.close",
      "threads.release",
      "threads.setModel",
      "threads.rename",
      "threads.extensions.call",
      "devices.rename",
    ],
    person: [
      "threads.read",
      "threads.locate",
      "threads.send",
      "threads.interrupt",
      "threads.close",
      "threads.release",
      "threads.setModel",
      "threads.rename",
      "threads.extensions.call",
      "devices.rename",
    ],
    // The rename answers the device it renamed, whose id is the caller's own input.
    session: ["devices.rename"],
  },
  fault: {},
}

describe("the non-disclosure scan over the whole root", () => {
  test("#given the scanner #when a canary sits in a value, a key, a nested error and its stack #then each is found (negative control)", () => {
    const planted = {
      value: `x ${CANARIES.accessToken} y`,
      [CANARIES.userCode]: 1,
      nested: [{ error: new Error(`failed with ${CANARIES.privateKey}`) }],
    }
    expect(canariesIn(planted).length).toBeGreaterThanOrEqual(3)
  })

  test("#given the scan's ports with one left at its default #then the scan refuses to run, naming it (control)", () => {
    const home = mkdtempSync(join(tmpdir(), "non-disclosure-default-port-"))
    directories.push(home)
    const { remote: _remote, ...withoutRemote } = canaryPorts(true, home)
    expect(notFake(withoutRemote)).toEqual(["remote"])
    expect(notFake({ ...withoutRemote, remote: fakeRemote(true) as RemoteThreadSurface })).toEqual(["remote"])
    expect(notFake(canaryPorts(true, home))).toEqual([])
  })

  test("#given a store holding canaries in two tables #when it is read column by column #then each column is named (negative control)", () => {
    const home = mkdtempSync(join(tmpdir(), "non-disclosure-store-"))
    directories.push(home)
    const path = join(home, GATEWAY_STORE)
    const db = new Database(path)
    db.run("CREATE TABLE deliveries (body TEXT, sender TEXT)")
    db.run("CREATE TABLE receipts (result TEXT)")
    db.query("INSERT INTO deliveries VALUES (?, ?)").run(`hi ${INPUT_CANARY}`, "s")
    db.query("INSERT INTO receipts VALUES (?)").run(`echo ${INPUT_CANARY} ${CANARIES.accessToken}`)
    db.close()
    expect(storeColumnsHolding(path, [INPUT_CANARY]).toSorted()).toEqual(["deliveries.body", "receipts.result"])
    expect(storeColumnsHolding(path, CANARY_VALUES)).toEqual(["receipts.result"])
  })

  // The shipped thread facade's store extension operations answer an unexpected store failure with fixed text (the
  // thread core's own mapping); the store's exception never reaches the caller.
  test("#given the shipped thread facade and a failing store #when it registers a store extension #then no canary reaches the caller", async () => {
    const home = mkdtempSync(join(tmpdir(), "non-disclosure-facade-"))
    directories.push(home)
    const facade = createThreadSdk({ agentDir: home, cwd: home, uid: 501, user: "scan", store: faultingStore() })
    const extension = {
      name: "x",
      migrations: [["create table t (id)"]],
      moduleUrl: "file:///tmp/x.js",
      sessionCallable: [],
    }
    const settled = await facade.registerStoreExtension(extension as never).then(
      (answer) => answer,
      (error: unknown) => error,
    )
    expect(settled).toMatchObject({ kind: "refused", code: "internal_error" })
    expect(canariesIn(settled)).toEqual([])
  })

  test("#given every call of the root #when the driver builds its inputs #then both pass the call's schema, so the scan is never refused for its input", () => {
    const keys = Object.keys(ROOT_CALLS) as RootCallKey[]
    const refused = keys.flatMap((key) =>
      [true, false].flatMap((optional) =>
        inputAccepts(key, sampleOf(ROOT_CALLS[key].input as never, INPUT_CANARY, "", optional))
          ? []
          : [`${key}${optional ? "" : " (required only)"}`],
      ),
    )
    expect(refused).toEqual([])
    // Control: the old one-bag driver input is refused by a closed schema, which is the quiet pass this guards against.
    expect(keys.some((key) => !inputAccepts(key, { thread: "t-1", message: "m", name: "n", id: "d-1" }))).toBe(true)
  })

  for (const fault of [false, true])
    for (const principal of PRINCIPALS)
      test(`#given ${principal?.kind ?? "the default script"} root${fault ? " with every port faulting" : ""} #when every call of the root runs #then no canary reaches an answer, an event, an exception, the console or a written file`, async () => {
        const home = mkdtempSync(join(tmpdir(), "non-disclosure-"))
        directories.push(home)
        const logged: unknown[] = []
        const restore = (["log", "info", "warn", "error", "debug"] as const).map((level) => {
          const original = console[level]
          console[level] = (...args: unknown[]) => void logged.push(args)
          return () => void (console[level] = original)
        })
        const captured: Captured[] = []
        touches.length = 0
        const roster = fault ? undefined : await rosterService(CANARIES.socketSecret)
        const options = {
          env: {
            OMO_SERVICE_API_URL: "https://accounts.example.test",
            HOME: home,
            OMO_CODING_AGENT_DIR: home,
            ...(roster === undefined ? {} : { OMO_DEVICE_SERVICE_STATE_DIR: roster.stateDir }),
          },
          cwd: home,
          home,
          agentDir: home,
          ...(principal === undefined ? {} : { principal }),
          ports: recorded(scanPorts(fault, home), "ports"),
        }
        try {
          const root = assembleOmoSdk(options, {})
          for (const key of Object.keys(ROOT_CALLS) as RootCallKey[])
            await drive(
              key,
              key.split(".").reduce<unknown>((node, part) => Reflect.get(Object(node), part), root),
              captured,
            )
          await root.dispose()
        } finally {
          for (const undo of restore) undo()
          await roster?.stop()
        }
        const paths = filesUnder(home)
        const written = paths
          .filter((path) => !isStoreFile(path))
          .map((path) => ({ path, text: readFileSync(path, "latin1") }))
        const stores = paths.filter((path) => path.endsWith(GATEWAY_STORE))
        expect(stores.flatMap((path) => storeColumnsHolding(path, CANARY_VALUES))).toEqual([])
        expect(
          stores
            .flatMap((path) => storeColumnsHolding(path, [INPUT_CANARY]))
            .filter((column) => !(INPUT_ALLOWED_IN_STORE as readonly string[]).includes(column)),
        ).toEqual([])
        const echoed = captured.filter((entry) => isB8Echo(entry) && canariesIn(entry.answer).length > 0)
        const strict = captured.filter((entry) => !echoed.includes(entry))
        const everyCanary = [...CANARY_VALUES, INPUT_CANARY]
        expect({
          answers: canariesIn(strict),
          console: canariesIn(logged, "$", new Set(), everyCanary),
          files: canariesIn(written, "$", new Set(), everyCanary),
        }).toEqual({
          answers: [],
          console: [],
          files: [],
        })
        // Reach (design lane ruling): every call got past the boundary with its schema-valid input; a call the boundary
        // refuses for its input proves nothing behind it and fails by name. A refused cell answers its principal refusal.
        const refused = boundaryRefusals((principal ?? { kind: "script", uid: 0 }) as OmoPrincipal, options)
        const errorOf = (entry: Captured) => {
          const answer = entry.answer as {
            readonly error?: unknown
            readonly kind?: unknown
            readonly failure?: unknown
          }
          return answer.kind === "end" ? answer.failure : answer.error
        }
        expect(
          captured.filter((entry) => Bun.deepEquals(errorOf(entry), invalidInput(entry.key))).map((entry) => entry.key),
        ).toEqual([])
        expect(
          [...refused].filter(
            ([key, error]) => !captured.some((entry) => entry.key === key && Bun.deepEquals(errorOf(entry), error)),
          ),
        ).toEqual([])
        expect(
          captured
            .filter((entry) => canariesIn(entry.answer, "$", new Set(), [INPUT_CANARY]).length > 0)
            .map((entry): string => entry.key)
            .filter((key, index, keys) => keys.indexOf(key) === index),
        ).toEqual([...(EXPECTED_INPUT_ECHO[fault ? "fault" : "ok"][principal?.kind ?? "script"] ?? [])])
        // The healthy pass's own coverage (design lane ruling): no internal_error anywhere (a broken fixture, never a
        // result), the kind of every built admitted call exactly as the table says, each call's own port reached, and the
        // rows whose content was not scanned printed with their owner, so the residual stays on the record.
        if (!fault) {
          const who = principal?.kind ?? "script"
          const kindOf = (entry: Captured): string => {
            const code = (errorOf(entry) as { readonly code?: unknown } | undefined)?.code
            if (typeof code === "string") return code
            const kind = (entry.answer as { readonly kind?: unknown } | undefined)?.kind
            return typeof kind === "string" ? kind : "ok"
          }
          expect(captured.filter((entry) => kindOf(entry) === "internal_error").map((entry) => entry.key)).toEqual([])
          const observed = Object.fromEntries(
            [...new Set(captured.map((entry) => entry.key))]
              .filter((key) => !refused.has(key))
              .map((key) => [key, [...new Set(captured.filter((entry) => entry.key === key).map(kindOf))].toSorted()])
              .filter(([, found]) => !Bun.deepEquals(found, ["not_implemented"])),
          )
          const rows = Object.entries(HEALTHY).flatMap(([key, row]) =>
            row.kinds[who] === undefined ? [] : [[key, row] as const],
          )
          expect(observed).toEqual(Object.fromEntries(rows.map(([key, row]) => [key, row.kinds[who]])))
          expect(
            rows
              .filter(
                ([key, row]) =>
                  row.port !== undefined &&
                  !touches.some((touch) => touch.key === key && touch.port.startsWith(row.port ?? "")),
              )
              .map(([key]) => key),
          ).toEqual([])
          expect(rows.filter(([, row]) => !row.scanned && row.kinds[who]?.includes("ok")).map(([key]) => key)).toEqual(
            [],
          )
          const notScanned = rows.filter(([, row]) => !row.scanned)
          console.info(
            `non-disclosure healthy pass, ${who}: ${rows.length - notScanned.length} calls scanned through their answer, ${notScanned.length} not: ${notScanned.map(([key, row]) => `${key} (${row.owner}: ${row.reason})`).join("; ")}`,
          )
        }
        // Reach by case, with every port faulting: a refused cell and a pure call stop before any port; a call that is
        // permitted and built reaches a port, unless it is named below with the reason it answers without one.
        if (fault) {
          const touched = (key: string) => touches.some((touch) => touch.key === key)
          const unbuilt = (key: string) =>
            captured
              .filter((entry) => entry.key === key)
              .every((entry) => (errorOf(entry) as { readonly code?: unknown } | undefined)?.code === "not_implemented")
          expect([...refused.keys()].filter(touched)).toEqual([])
          expect([...PURE_CALLS].filter(touched)).toEqual([])
          const silent: string[] = (Object.keys(ROOT_CALLS) as RootCallKey[]).filter(
            (key) => !refused.has(key) && !PURE_CALLS.has(key) && !unbuilt(key) && !touched(key),
          )
          expect(silent).toEqual([...(ANSWERED_WITHOUT_A_PORT[principal?.kind ?? "script"] ?? [])])
        }
        expect([...new Set(echoed.map((entry): string => entry.key))]).toEqual([
          ...(EXPECTED_B8_ECHO[fault ? "fault" : "ok"][principal?.kind ?? "script"] ?? []),
        ])
      })
})

// Positive controls (LEAD ruling on t72y's note): a canary in a field the answer DOES carry is found, one per port family,
// so the scan's zero above is evidence and not a blind matcher. The roster's label is what devices.list returns as name.
describe("the scan finds a canary that rides a field the answer carries", () => {
  const CARRIED = "CANARY-carried-9e21"
  const signedIn = { device: { id: "dev-1", name: "laptop" }, accessToken: "t" }
  const sessionRoot = (stateDir: string) =>
    assembleOmoSdk(
      {
        env: { OMO_SERVICE_API_URL: "https://accounts.example.test", OMO_DEVICE_SERVICE_STATE_DIR: stateDir },
        cwd: tmpdir(),
        principal: { kind: "session", session_id: "s-1" },
        ports: {
          desktopLaunch: () => false,
          credentialStore: { read: async () => signedIn as never },
          session: {
            accessToken: async () => "t",
            request: (async (path: string, init?: { method?: string }) => {
              if (path === "/v1/me") return { user: { email: CARRIED }, account: { id: "acct-1" } }
              if (path === "/v1/devices") return { devices: [{ id: "dev-2", name: CARRIED, revokedAt: null }] }
              if (init?.method === "PATCH") return { id: "dev-2", name: CARRIED, revokedAt: null }
              throw new Error(`unexpected ${path}`)
            }) as never,
          },
        },
      },
      {},
    )
  const found = (answer: unknown) => canariesIn(answer, "$", new Set(), [CARRIED])

  test("#given the carried field of each port family holds a canary #when a session calls it #then the scan finds it in the answer", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "la-"))
    const world = defaultWorld()
    const owner = await startFakeOwner({
      stateDir,
      world: { ...world, devices: world.devices.map((device) => ({ ...device, label: CARRIED })) },
    })
    try {
      const root = sessionRoot(stateDir)
      expect(found(await root.devices.list({}))).not.toEqual([])
      expect(found(await root.account.devices({}))).not.toEqual([])
      expect(found(await root.devices.rename({ id: "dev-2", name: "studio" }))).not.toEqual([])
      expect(found(await root.account.whoami({}))).not.toEqual([])
      root.close()
    } finally {
      await owner.stop()
      rmSync(stateDir, { recursive: true, force: true })
    }
  })
})
