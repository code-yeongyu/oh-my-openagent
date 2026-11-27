import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Preloaded into a child running one account verb for the account goldens (account-goldens.test.ts). Nothing here
// reaches a real account, keychain, keychain helper, browser or device service:
// - the OS credential store is one JSON file under the temporary HOME (GOLDEN_STORE_FILE), seeded by the test and read
//   back after the run; its "*" slot answers a read of any key, so a seeded sign-in needs no knowledge of key names;
// - OmO's own keychain helper is a scripted stand-in kept in the same directory;
// - the user database's home (`os.userInfo().homedir`) is the temporary HOME, so OmO's own keychain lives there;
// - the browser opener answers the sign-in page itself: it calls the loopback callback with the state it was given;
// - accounts open only when the test says so (GOLDEN_ACCOUNTS=open), as the other launcher suites open them.

const home = process.env.HOME
const storeFile = process.env.GOLDEN_STORE_FILE
if (home === undefined || storeFile === undefined || !storeFile.startsWith(home))
  throw new Error("the account goldens need a temporary HOME and a store file under it")

// Fail closed on the network: a request to anything but the loopback address (where the test's fake service and the
// sign-in callback listen) is refused before it leaves, and recorded in .golden-refused under HOME, which the test
// requires to stay absent. Covers fetch, node:http and node:https, the clients the account code uses.
const refusedFile = join(home, ".golden-refused")
const requireLoopback = (target: string | URL): void => {
  const url = new URL(String(target))
  if (url.hostname === "127.0.0.1") return
  appendFileSync(refusedFile, `${url.protocol}//${url.host}\n`)
  throw new Error("account goldens: only the loopback address is reachable")
}
const realFetch = globalThis.fetch
globalThis.fetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    requireLoopback(input instanceof Request ? input.url : String(input))
    return realFetch(input, init)
  },
  { preconnect: realFetch.preconnect },
)
for (const name of ["node:http", "node:https"] as const) {
  const client = require(name) as typeof import("node:http")
  const scheme = name === "node:http" ? "http:" : "https:"
  for (const method of ["request", "get"] as const) {
    const real = client[method] as (...args: unknown[]) => unknown
    client[method] = ((...args: unknown[]) => {
      const [first] = args
      if (typeof first === "string" || first instanceof URL) requireLoopback(first)
      else {
        const options = (first ?? {}) as { host?: string; hostname?: string; port?: number }
        requireLoopback(`${scheme}//${options.hostname ?? options.host ?? "localhost"}`)
      }
      return real(...args)
    }) as typeof client.request
  }
}

type Slots = Record<string, string>
const readSlots = (): Slots => JSON.parse(readFileSync(storeFile, "utf8")) as Slots
const writeSlots = (slots: Slots): void => writeFileSync(storeFile, JSON.stringify(slots))
const slot = ({ service, name }: { readonly service: string; readonly name: string }) => `${service}\n${name}`

Object.defineProperty(Bun, "secrets", {
  value: {
    get: async (key: { readonly service: string; readonly name: string }) => {
      const slots = readSlots()
      return slots[slot(key)] ?? slots["*"] ?? null
    },
    set: async (key: { readonly service: string; readonly name: string; readonly value: string }) => {
      writeSlots({ ...readSlots(), [slot(key)]: key.value })
    },
    delete: async (key: { readonly service: string; readonly name: string }) => {
      const slots = readSlots()
      const had = slots[slot(key)] !== undefined || slots["*"] !== undefined
      delete slots[slot(key)]
      delete slots["*"]
      writeSlots(slots)
      return had
    },
    [Symbol.for("omo.test.injectedSecrets")]: true,
  },
})

const os = require("node:os") as typeof import("node:os")
const realUserInfo = os.userInfo
os.userInfo = ((options?: { encoding: BufferEncoding }) => ({
  ...realUserInfo(options),
  homedir: home,
})) as typeof os.userInfo

// OmO's own keychain helper, scripted: the login and OmO stores are slots of one JSON file, and the store's state
// files are the ones the real helper keeps (dedicated-store.ts reads them).
const helperFile = join(home, ".golden-helper.json")
const storeRoot = join(home, "Library", "Application Support", "OmO", "credential-keychain")
type HelperState = { login?: string; omo?: string }
const helperState = (): HelperState => {
  try {
    return JSON.parse(readFileSync(helperFile, "utf8")) as HelperState
  } catch {
    return {}
  }
}
const saveHelper = (state: HelperState): void => writeFileSync(helperFile, JSON.stringify(state))
const storeKey = (store: string): "login" | "omo" => (store === "login" ? "login" : "omo")
const helperCall = async (call: {
  readonly verb: string
  readonly account: string
  readonly store?: string
  readonly value?: string
}): Promise<Record<string, unknown>> => {
  const state = helperState()
  const key = storeKey(call.store ?? "omo")
  if (call.account.endsWith(".staging")) return { ok: true }
  switch (call.verb) {
    case "store-create":
      mkdirSync(storeRoot, { recursive: true })
      return { ok: true, created: true }
    case "store-activate":
      writeFileSync(join(storeRoot, "active"), "")
      return { ok: true }
    case "store-deactivate":
      rmSync(join(storeRoot, "active"), { force: true })
      return { ok: true }
    case "store-erase":
      rmSync(storeRoot, { recursive: true, force: true })
      return { ok: true }
    case "read":
      return state[key] === undefined ? { ok: true, missing: true } : { ok: true, owned: true, value: state[key] }
    case "write":
      saveHelper({ ...state, [key]: call.value })
      return { ok: true }
    case "remove": {
      const { [key]: _gone, ...rest } = state
      saveHelper(rest)
      return { ok: true }
    }
    default:
      return { ok: false, error: "unsupported" }
  }
}
const helperMode = process.env.GOLDEN_HELPER ?? "ready"
const access =
  helperMode === "missing"
    ? { kind: "missing" }
    : {
        kind: "ready",
        path: join(home, "omo-keychain"),
        call: (call: Parameters<typeof helperCall>[0]) => helperCall(call),
      }
const helperKey = Symbol.for("omo.keychain-helper.process.v1")
Object.assign(globalThis, {
  [helperKey]: {
    secretsQueue: Promise.resolve(),
    interactionSwitch: undefined,
    approvalCache: undefined,
    entryCandidates: [],
    helperAccess: Promise.resolve(access),
    heldPromptLocks: new Set(),
    handOff: undefined,
  },
})

// The browser opener: the sign-in page "approves" by calling the loopback callback with the state it was sent.
const childProcess = require("node:child_process") as typeof import("node:child_process")
const realExecFile = childProcess.execFile
const OPENERS = new Set(["/usr/bin/open", "xdg-open", "rundll32.exe"])
childProcess.execFile = ((file: string, args: readonly string[], options: unknown, callback: unknown) => {
  if (!OPENERS.has(file)) return (realExecFile as (...rest: unknown[]) => unknown)(file, args, options, callback)
  const page = new URL(String(args[args.length - 1]))
  const redirect = new URL(page.searchParams.get("redirect_uri") ?? "")
  if (redirect.hostname !== "127.0.0.1") {
    appendFileSync(refusedFile, `${redirect.protocol}//${redirect.host}\n`)
    ;(callback as (error: Error | null) => void)(new Error("account goldens: the callback is not a loopback address"))
    return undefined
  }
  redirect.search = new URLSearchParams({
    code: "golden-browser-code",
    state: page.searchParams.get("state") ?? "",
  }).toString()
  void fetch(redirect.href, { proxy: "" }).then(
    () => (callback as (error: Error | null) => void)(null),
    (error: Error) => (callback as (error: Error | null) => void)(error),
  )
  return undefined
}) as typeof childProcess.execFile

// A test sign-in must not install or link a device service on the host running the suite (omo#13627).
Object.assign(globalThis, {
  [Symbol.for("omo.test.skipRemoteLoginSetup")]: true,
  ...(process.env.GOLDEN_ACCOUNTS === "open" ? { [Symbol.for("omo.test.serviceAccountsOpen")]: true } : {}),
})

// On Linux the CLI asks the Secret Service over D-Bus whether the default collection is locked; answer unlocked.
if (process.platform === "linux") {
  const bin = join(home, ".fake-gdbus")
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, "gdbus"), "#!/bin/sh\necho '(<false>,)'\n", { mode: 0o755 })
  process.env.PATH = `${bin}:${process.env.PATH ?? ""}`
}
