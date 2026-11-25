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
import type { GatewayStore } from "../../thread/gateway/store"
import type { ThreadHost } from "../../thread/tools"
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

function canaryPorts(fault: boolean): OmoSdkPorts {
  return {
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
    host: canaryHost(fault),
    // With ports faulting the gateway store faults too; healthy, the store is real, so its file is read column by column.
    ...(fault ? { store: faultingStore() } : {}),
  }
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
  if (typeof value === "function")
    return function (this: unknown, ...args: unknown[]) {
      if (running !== undefined) touches.push({ key: running, port })
      return (value as (...inner: unknown[]) => unknown).apply(this, args)
    } as T
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value
  return new Proxy(value, {
    get: (target, name, receiver) =>
      typeof name === "symbol" || name === "then"
        ? Reflect.get(target, name, receiver)
        : recorded(Reflect.get(target, name, receiver), `${port}.${name}`),
  })
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
// config.status reads the config files under the caller's home directly (no port); daemon.warm opens the operator
// daemon's socket in the agent dir directly (the scan's has none). Both answer without a faked port.
const ANSWERED_WITHOUT_A_PORT: Readonly<Record<string, readonly string[]>> = {
  script: ["config.status", "daemon.warm"],
  person: ["config.status", "daemon.warm"],
  session: ["config.status"],
  service: ["config.status"],
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
          ports: recorded(canaryPorts(fault), "ports"),
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
