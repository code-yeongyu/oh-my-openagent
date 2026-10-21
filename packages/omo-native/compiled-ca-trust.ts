import { X509Certificate } from "node:crypto"
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as nodeTls from "node:tls"

/**
 * Certificate trust for the compiled engine (#10215).
 *
 * A `bun build --compile` binary trusts only Bun's bundled CA list, and `--use-system-ca` passed to
 * it is inert (it reaches `process.argv` as a plain string). So the engine installs bundled + OS
 * store + extras itself, at the top of every start: `host ensure`, the host daemon it spawns, and
 * the provisioned handoff all run this entry again. The OS store is read off the main thread, and
 * `compile-entry` awaits it once, bounded, before any engine code runs (#10760).
 *
 * Extras come from `OMO_EXTRA_CA_CERTIFICATES`, PEM text (never a path) that the desktop validated
 * and its server set for the engine (sisyphuslabs/omo-desktop-app#2760). It is re-validated here
 * with the same rules and a bad value fails closed: the engine refuses to start rather than run
 * with a trust set the caller did not intend.
 */
export const ENGINE_EXTRA_CA_ENV = "OMO_EXTRA_CA_CERTIFICATES"
/** One environment variable on every OS: Windows caps a variable at 32,767 characters. */
export const MAX_EXTRA_CA_BYTES = 24 * 1024

const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----\n([A-Za-z0-9+/=\n]*?)-----END \1-----/g

export class ExtraCaCertificatesError extends Error {
  override readonly name = "ExtraCaCertificatesError"
}

/** PEM `CERTIFICATE` blocks only, each a CA; whitespace is the only other content allowed. */
export function parseExtraCaCertificates(text: string): string[] {
  if (Buffer.byteLength(text, "utf8") > MAX_EXTRA_CA_BYTES) {
    throw new ExtraCaCertificatesError(`${ENGINE_EXTRA_CA_ENV} is larger than ${MAX_EXTRA_CA_BYTES / 1024} KiB`)
  }
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
  const certificates = new Map<string, string>()
  for (const [block, label] of normalized.matchAll(PEM_BLOCK)) {
    if (label !== "CERTIFICATE") throw new ExtraCaCertificatesError(`${ENGINE_EXTRA_CA_ENV} contains a ${label} block`)
    let certificate: X509Certificate
    try {
      certificate = new X509Certificate(block)
    } catch {
      throw new ExtraCaCertificatesError(`${ENGINE_EXTRA_CA_ENV} holds a certificate that cannot be read`)
    }
    if (!certificate.ca) throw new ExtraCaCertificatesError(`${ENGINE_EXTRA_CA_ENV} holds a certificate that is not a CA`)
    certificates.set(certificate.fingerprint256, certificate.toString())
  }
  if (certificates.size === 0 || normalized.replace(PEM_BLOCK, "").trim().length > 0) {
    throw new ExtraCaCertificatesError(`${ENGINE_EXTRA_CA_ENV} is not a PEM certificate bundle`)
  }
  return [...certificates.values()]
}

type TrustApi = Pick<typeof nodeTls, "getCACertificates" | "setDefaultCACertificates">

export interface EngineTrustReport {
  readonly installed: boolean
  readonly bundled: number
  /** OS-store certificates installed so far: 0 until the off-thread read lands (#10760). */
  readonly system: number
  /** Certificates `NODE_EXTRA_CA_CERTS` loaded. */
  readonly ambient: number
  readonly extra: number
}

/** How the OS store reached the trust set: read, still unanswered at the bound, failed, or not read at all. */
export type SystemStoreOutcome = "loaded" | "timed-out" | "failed" | "skipped"

export interface EngineTrustOptions {
  /** Reads the OS store off the main thread. Default: a Worker calling `getCACertificates("system")`. */
  readonly loadSystem?: () => Promise<readonly string[]>
  /** `--version` / `-v` / `--help`: never touch the OS store (#10760). */
  readonly skipSystem?: boolean
  readonly warn?: (message: string) => void
  /** Where the answered store is handed to children: the agent dir's `cache` (compile-entry passes it). */
  readonly handoffDir?: string
  /** This process's parent and own pid (tests set them; production uses `process`). */
  readonly parentPid?: number
  readonly pid?: number
  /** The uid the handed-off file must belong to (tests set it; production uses `process.getuid()`). */
  readonly ownerUid?: number
}

/** How long startup waits for the OS store before going on with what is installed. */
export const SYSTEM_STORE_BUDGET_MS = 1_500

/**
 * The parent's RESOLVED store state, handed to the children that re-run this entry (`thread`,
 * `daemon`, `host status --all` through `engine.run`, and the provisioned handoff), so they never read
 * the OS store again and the slow-store warning prints once per user command (#10771 review). It is
 * never written into this process's own environment: only those spawns get it, through
 * `selfSpawnTrustEnv`, so a tool shell or any other long-lived descendant never inherits it. The
 * value is `<parent pid>:<state>`, and a child honors it only when that pid is its parent (or itself,
 * after the handoff's in-place exec). Only the OUTCOME crosses; never a path or certificates. States:
 * - `loaded`: the store answered; the child reads `<agent dir>/cache/system-ca.pem` (a fixed path, never
 *   from the environment) only if it is a regular file, every block is a CA, and on POSIX it is owned
 *   by this user and private (Windows has no comparable uid/mode bits, so there only the CA check
 *   applies); otherwise it reads the OS store itself.
 * - `empty`: the store answered with no certificates.
 * - `unanswered` / `failed`: the store missed the bound or failed; the child starts like its parent,
 *   bundled + extras, with no second warning.
 */
export const SYSTEM_STORE_STATE_ENV = "OMO_SYSTEM_CA_STORE"
export const SYSTEM_STORE_UNANSWERED = "unanswered"
type HandedState = "loaded" | "empty" | "unanswered" | "failed"
const HANDED_STATES: readonly string[] = ["loaded", "empty", "unanswered", "failed"]

export function encodeSystemStoreState(state: HandedState, pid = process.pid): string {
  return `${pid}:${state}`
}

/** The state this process's parent handed it, or undefined when it came from anyone else. */
export function decodeSystemStoreState(
  value: string | undefined,
  parentPid = process.ppid,
  ownPid = process.pid,
): HandedState | undefined {
  if (value === undefined) return undefined
  const separator = value.indexOf(":")
  const state = value.slice(separator + 1)
  const issuer = value.slice(0, separator)
  // The own-pid branch exists only for the provisioned handoff's in-place exec (the same pid runs the
  // new image); a spawned child, including Windows' handoff, always matches its parent pid.
  if (separator <= 0 || (issuer !== String(parentPid) && issuer !== String(ownPid)) || !HANDED_STATES.includes(state)) {
    return undefined
  }
  return state as HandedState
}

let resolvedState: HandedState | undefined

/** `env` plus this process's resolved store outcome, for a self-spawn only (`engine.run`, the handoff). */
export function selfSpawnTrustEnv<T extends Record<string, string | undefined>>(env: T): T {
  const { [SYSTEM_STORE_STATE_ENV]: _inherited, ...rest } = env
  return (resolvedState === undefined ? rest : { ...rest, [SYSTEM_STORE_STATE_ENV]: encodeSystemStoreState(resolvedState) }) as T
}

let systemStore: Promise<SystemStoreOutcome> = Promise.resolve("skipped")
let systemSettled = false

/**
 * Installs bundled + `NODE_EXTRA_CA_CERTS` (which Bun loads natively before this runs) + the validated
 * extras at once, and reads the OS store OFF the main thread (#10760): on some Macs the security
 * server never answers `getCACertificates("system")`, which used to hang every start, `--version`
 * included. When the read lands its certificates are added and `NODE_USE_SYSTEM_CA=1` is set for
 * later `BUN_BE_BUN` children (which read the store themselves); until then, and forever when it
 * never lands, those children keep the bundled set like this process does.
 * `NODE_EXTRA_CA_CERTS` is honored because standalone CLI users behind a corporate proxy set it; the
 * desktop strips it from the engines it starts (omo-desktop-app#2766). Those ambient certificates are
 * taken as Node loaded them, without the `CA:TRUE` and strict-parse checks the `OMO_EXTRA_CA_CERTIFICATES`
 * extras get, matching standard Node behaviour. `OMO_EXTRA_CA_CERTIFICATES` stays in the environment:
 * the host daemon is a grandchild and needs it.
 */
export function installEngineCaTrust(
  env: NodeJS.ProcessEnv = process.env,
  tls: TrustApi = nodeTls,
  options: EngineTrustOptions = {},
): EngineTrustReport {
  const raw = env[ENGINE_EXTRA_CA_ENV]
  const extra = raw === undefined || raw === "" ? [] : parseExtraCaCertificates(raw)
  systemSettled = false
  if (typeof tls.getCACertificates !== "function" || typeof tls.setDefaultCACertificates !== "function") {
    // A runtime without the trust APIs still lets `BUN_BE_BUN` children read the store themselves.
    env.NODE_USE_SYSTEM_CA = "1"
    systemStore = Promise.resolve("skipped")
    systemSettled = true
    return { installed: false, bundled: 0, system: 0, ambient: 0, extra: 0 }
  }
  const bundled = tls.getCACertificates("bundled")
  const ambient = tls.getCACertificates("extra")
  const base = [...new Set([...bundled, ...ambient, ...extra])]
  tls.setDefaultCACertificates(base)
  const inherited = decodeSystemStoreState(env[SYSTEM_STORE_STATE_ENV], options.parentPid ?? process.ppid, options.pid ?? process.pid)
  delete env[SYSTEM_STORE_STATE_ENV]
  resolvedState = undefined
  const fromParent =
    inherited === "loaded" && options.handoffDir !== undefined
      ? readInheritedStore(join(options.handoffDir, "system-ca.pem"), options.ownerUid ?? process.getuid?.())
      : undefined
  if (fromParent !== undefined) {
    tls.setDefaultCACertificates([...new Set([...base, ...fromParent])])
    env.NODE_USE_SYSTEM_CA = "1"
    resolvedState = "loaded"
    systemStore = Promise.resolve("loaded")
    systemSettled = true
  } else if (options.skipSystem === true || inherited === "empty" || inherited === "unanswered" || inherited === "failed") {
    if (inherited !== undefined && inherited !== "loaded") resolvedState = inherited
    systemStore = Promise.resolve("skipped")
    systemSettled = true
  } else {
    const warn = options.warn ?? ((message: string) => process.stderr.write(`omo: ${message}\n`))
    systemStore = (options.loadSystem ?? loadSystemStoreOffThread)().then(
      (system) => {
        tls.setDefaultCACertificates([...new Set([...base, ...system])])
        env.NODE_USE_SYSTEM_CA = "1"
        const state: HandedState | undefined =
          system.length === 0 ? "empty" : writeStoreHandoff(system, options.handoffDir) ? "loaded" : undefined
        resolvedState = state
        systemSettled = true
        return "loaded" as const
      },
      (error: unknown) => {
        systemSettled = true
        resolvedState = "failed"
        warn(`could not read the system certificate store (${error instanceof Error ? error.message : String(error)}); using the bundled certificates`)
        return "failed" as const
      },
    )
  }
  return { installed: true, bundled: bundled.length, system: 0, ambient: ambient.length, extra: extra.length }
}


/** The store's PEM set for this process's children, owner-only and replaced atomically; false when it can't be written. */
function writeStoreHandoff(system: readonly string[], dir: string | undefined): boolean {
  if (dir === undefined) return false
  const path = join(dir, "system-ca.pem")
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    if (process.platform !== "win32") chmodSync(dir, 0o700)
    const staging = `${path}.${process.pid}.tmp`
    // `mode` applies only on create: a leftover staging file from a reused pid would keep its mode.
    rmSync(staging, { force: true })
    writeFileSync(staging, system.join("\n"), { mode: 0o600 })
    renameSync(staging, path)
    return true
  } catch {
    return false
  }
}

/**
 * A parent's handed-off store, or undefined, in which case the child reads the OS itself: the file
 * must be this user's and private (POSIX), and every block must parse as a certificate.
 */
function readInheritedStore(path: string, ownerUid: number | undefined): readonly string[] | undefined {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile()) return undefined
    if (process.platform !== "win32" && (stat.uid !== ownerUid || (stat.mode & 0o077) !== 0)) return undefined
    const blocks = readFileSync(path, "utf8").match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)
    if (blocks === null) return undefined
    const certificates = blocks.map((block) => new X509Certificate(block))
    if (!certificates.every((certificate) => certificate.ca)) return undefined
    return certificates.map((certificate) => certificate.toString())
  } catch {
    return undefined
  }
}

let slowStoreWarned = false

/**
 * Waits for the OS store at most `budgetMs`. `compile-entry` awaits this before any engine code runs,
 * so every client that reads the runtime trust set (node:https / node:tls) starts with the store on
 * every machine whose store answers, and a machine whose store never answers is held up once, by the
 * bound, not forever. Bun's `fetch` and `WebSocket` never read `setDefaultCACertificates` (they take
 * only what `NODE_EXTRA_CA_CERTS` / `NODE_USE_SYSTEM_CA` say at process start), so neither this wait
 * nor #10219's install changes what they trust.
 */
export async function engineCaTrustReady(
  budgetMs = SYSTEM_STORE_BUDGET_MS,
  warn: (message: string) => void = (message) => process.stderr.write(`omo: ${message}\n`),
): Promise<SystemStoreOutcome> {
  if (systemSettled) return await systemStore
  let timer: ReturnType<typeof setTimeout> | undefined
  const outcome = await Promise.race([
    systemStore,
    new Promise<"timed-out">((resolve) => {
      timer = setTimeout(() => resolve("timed-out"), budgetMs)
    }),
  ])
  clearTimeout(timer)
  if (outcome === "timed-out" && !systemSettled) resolvedState = "unanswered"
  if (outcome === "timed-out" && !slowStoreWarned) {
    slowStoreWarned = true
    warn(
      `the system certificate store did not answer within ${budgetMs / 1000} s; starting with the bundled certificates and any NODE_EXTRA_CA_CERTS / ${ENGINE_EXTRA_CA_ENV}, and adding the store's certificates when it answers. If your network needs a certificate from the system store (a company proxy, for example), set NODE_EXTRA_CA_CERTS to a PEM file with it.`,
    )
  }
  return outcome
}

// A Worker blocked inside the OS call cannot hold the process open (`unref`), and its result is
// plain PEM text, so nothing native crosses threads.
export const SYSTEM_STORE_WORKER_SOURCE = 'postMessage(require("node:tls").getCACertificates("system"))'

export function loadSystemStoreOffThread(source = SYSTEM_STORE_WORKER_SOURCE): Promise<readonly string[]> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([source], { type: "application/javascript" }))
    const worker = new Worker(url)
    worker.unref()
    worker.onmessage = (event: MessageEvent<readonly string[]>) => {
      resolve(event.data)
      void worker.terminate()
    }
    worker.onerror = (event: ErrorEvent) => {
      reject(new Error(event.message))
      void worker.terminate()
    }
  })
}
