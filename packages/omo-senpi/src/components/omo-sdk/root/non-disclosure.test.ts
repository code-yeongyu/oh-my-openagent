import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sampleOf } from "../../../../test-support/omo-sdk-sample-input"
import { type OmoPrincipal, ROOT_CALLS, type RootCallKey } from "../contract"
import { inputAccepts } from "../contract/validate"
import type { OmoSdkPorts } from "../options"
import { assembleOmoSdk } from "../assembly"
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
    // The thread controls honour the scan's 5 ms deadline (slice T1b); a clock that never moves keeps each on its ok path.
    waitClock: { now: () => started, after: () => () => undefined },
  }
}

const started = Date.now()

const PRINCIPALS = [
  undefined,
  { kind: "person", uid: 501 },
  { kind: "session", session_id: "s-1" },
  { kind: "connector", binding: "b-1" },
  { kind: "service" },
] as const

type Captured = { readonly key: RootCallKey; readonly answer: unknown }

// Each call runs twice: with every optional field, and with the required ones only, so an optional field this release
// does not build (answered not_implemented before any port) cannot hide the core behind it.
async function drive(key: RootCallKey, member: unknown, captured: Captured[]): Promise<void> {
  for (const optional of [true, false])
    await driveOnce(key, member, captured, sampleOf(ROOT_CALLS[key].input as never, INPUT_CANARY, "", optional))
}

async function driveOnce(key: RootCallKey, member: unknown, captured: Captured[], input: unknown): Promise<void> {
  try {
    const answer = (member as (input: unknown, options: unknown) => unknown)(input, { deadline_ms: 5 })
    if (typeof answer === "object" && answer !== null && Symbol.asyncIterator in answer) {
      for await (const event of answer as AsyncIterable<unknown>) captured.push({ key, answer: event })
      return
    }
    captured.push({ key, answer: await answer })
  } catch (error) {
    captured.push({ key, answer: error })
  }
}

// Where a caller's own input comes back in the answer to that caller, as observed (reported to the design lane).
const EXPECTED_INPUT_ECHO: Readonly<Record<"ok" | "fault", Readonly<Record<string, readonly string[]>>>> = {
  ok: {
    script: [
      "threads.read",
      "threads.receipt",
      "threads.messages",
      "threads.locate",
      "threads.send",
      "threads.interrupt",
      "threads.close",
      "threads.release",
      "threads.setModel",
      "threads.setReasoning",
      "threads.rename",
      "threads.archive",
      "threads.extensions.call",
    ],
    person: [
      "threads.read",
      "threads.receipt",
      "threads.messages",
      "threads.locate",
      "threads.send",
      "threads.interrupt",
      "threads.close",
      "threads.release",
      "threads.setModel",
      "threads.setReasoning",
      "threads.rename",
      "threads.archive",
      "threads.extensions.call",
    ],
  },
  fault: {
    script: ["threads.receipt", "threads.extensions.call"],
    person: ["threads.receipt", "threads.extensions.call"],
  },
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
        const options = {
          env: { OMO_SERVICE_API_URL: "https://accounts.example.test", HOME: home, OMO_CODING_AGENT_DIR: home },
          cwd: home,
          home,
          agentDir: home,
          ...(principal === undefined ? {} : { principal }),
          ports: canaryPorts(fault),
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
        const written = filesUnder(home).map((path) => ({ path, text: readFileSync(path, "latin1") }))
        const everyCanary = [...CANARY_VALUES, INPUT_CANARY]
        expect({
          answers: canariesIn(captured),
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
      })
})
