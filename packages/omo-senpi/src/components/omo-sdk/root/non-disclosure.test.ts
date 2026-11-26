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
import { invalidInput } from "./assemble"
import { boundaryRefusals } from "./authority"

// Security design 6, for the whole root (P1b's share): fake ports hold one canary per asset of 2.1; every call of the
// root type runs through its ok path or its answer as built, a refusal for each refused principal kind and one injected
// fault; the returned value, the failure, every stream event, every exception's message and stack, everything written
// to the console and every file the call wrote under the run's home and agent dir are scanned. Nothing of a canary may
// appear outside its row's destination; the scan of the root's result objects alone is not the I1 evidence, which is
// why the store, the console and the files are scanned too. The negative control proves the scanner finds a canary.
const CANARIES = {
  accessToken: "CANARY-access-6f1e",
  refreshToken: "CANARY-refresh-91ad",
  privateKey: "CANARY-privkey-3c07",
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
  const db = new Database(path, { readonly: true })
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
  accountSession: true,
  accountStore: true,
  custody: true,
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

function canaryPorts(fault: boolean, home: string): OmoSdkPorts {
  return withFakes(fault, home, {
    desktopLaunch: () => false,
    credentialStore: {
      read: fault
        ? failing(CANARIES.refreshToken)
        : async () =>
            ({
              accessToken: CANARIES.accessToken,
              refreshToken: CANARIES.refreshToken,
              privateKey: CANARIES.privateKey,
            }) as never,
    },
    session: {
      accessToken: async () => CANARIES.accessToken,
      request: fault
        ? failing(CANARIES.oauthToken)
        : async () => ({ user: { email: "owner@example.test" }, token: CANARIES.oauthToken }),
    },
    deviceServiceStatus: fault ? failing(CANARIES.providerKey) : async () => "not_running",
    signInProcess: failing(CANARIES.userCode) as never,
    // Slice A1b's ports: sign-out and forget act on this session and store; the store switch never reaches a helper.
    accountSession: {
      session: {
        logout: fault ? failing(CANARIES.oauthToken) : async () => true,
        forget: async () => undefined,
        update: failing(CANARIES.refreshToken),
        discard: async () => undefined,
      },
      store: { clear: fault ? failing(CANARIES.refreshToken) : async () => undefined },
    },
    accountStore: {
      platform: "darwin",
      available: async () => !fault,
      status: () => ({ store: "login", state: "absent", path: join(home, "credential-keychain") }),
      enable: fault
        ? failing(CANARIES.privateKey)
        : async () =>
            ({ kind: "refused", code: "switch_failed", message: "a fake store switch", store: "login" }) as never,
      disable: fault
        ? failing(CANARIES.privateKey)
        : async () =>
            ({ kind: "refused", code: "switch_failed", message: "a fake store switch", store: "login" }) as never,
    },
    custody: { begin: async () => ({ recorded: true, end: async () => true }), refused: async () => true },
    host: canaryHost(fault),
    // With ports faulting the gateway store faults too; healthy, it is a store the scan builds in its own scratch agent
    // dir, so its file is read column by column.
    store: fault ? faultingStore() : createGatewayStore({ agentDir: home }),
    remote: fault ? (fakeRemote(true) as RemoteThreadSurface) : listingRemote(),
    now: () => 1_764_000_000_000,
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
    ],
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
        const options = {
          env: { OMO_SERVICE_API_URL: "https://accounts.example.test", HOME: home, OMO_CODING_AGENT_DIR: home },
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
