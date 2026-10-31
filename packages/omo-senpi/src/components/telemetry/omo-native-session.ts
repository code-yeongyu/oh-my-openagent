import { realpathSync } from "node:fs"
import * as os from "node:os"
import { posix, win32 } from "node:path"

import {
  createEventTelemetryClient,
  getDailyActiveCaptureState,
  getDefaultTelemetryOsProvider,
  isTelemetryClientEnabled,
  type EventTelemetryClient,
  type EventTelemetrySetTimeout,
  type TelemetryDiagnosticInput,
  type TelemetryEnv,
  type TelemetryOsProvider,
  type TelemetryTransportFactory,
} from "@oh-my-opencode/telemetry-core/injected"
import { createSenpiTelemetryTransportFactory } from "./otlp"
import { isOmoTelemetryEnabled, type OmoConfig } from "@oh-my-opencode/omo-config-core"
import { isDarwinAutomountTriggerPath, isPathInside, type PathContainmentOptions } from "@oh-my-opencode/utils/path-containment"

import { deferUntilAfterFirstPaint } from "../../extension/startup-deferral"
import type { OmoSenpiComponent } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { loadSenpiOmoConfig } from "../config-resolution"
import { userInfo } from "node:os"
import { CONFIG_SELECTION_ENV_KEYS, withConfigSelection, type ConfigSelection } from "./session-summary-purge"
import { getSenpiTelemetryStateDir, recordSenpiDailyActive } from "./index"
import { createCategoryConfigCapture } from "./omo-native-category-config"
import {
  OMO_NATIVE_PROPERTY_ALLOWLISTS,
  OMO_NATIVE_SCHEMA_VERSION,
  createOmoNativeProductConfig,
  getOmoNativeAttribution,
  getOmoNativeStateDir,
  hashSessionId,
} from "./product-identity"
import { loadEngineTables, readConnectedAccounts } from "./account-inventory"
import { readOmoNativeInventory, type OmoNativeInventoryDiagnostic } from "./session-inventory"
import { resolveSessionModelRegistry } from "./session-model-registry"
import { resolveTelemetrySessionRole } from "./session-role-resolver"

export type { OmoNativeInventoryDiagnostic }

const SOURCE = "omo-native-session"
const SESSION_REASONS = new Set(["startup", "reload", "new", "resume", "fork"])

export type OmoNativeSessionOptions = {
  readonly diagnostics?: (input: TelemetryDiagnosticInput | OmoNativeInventoryDiagnostic) => void
  readonly env?: TelemetryEnv
  readonly hashSessionId?: (rawId: string) => string
  readonly isConfigEnabled?: (cwd: string | undefined, env: TelemetryEnv) => boolean
  readonly now?: Date
  readonly osProvider?: TelemetryOsProvider
  readonly setTimeoutFn?: EventTelemetrySetTimeout
  /** Device-reported IANA zone. Injected in tests; the host default reads the runtime's resolved zone. */
  readonly timeZone?: () => string
  readonly transportFactory?: TelemetryTransportFactory
}

export function createOmoNativeSessionComponent(options: OmoNativeSessionOptions = {}): OmoSenpiComponent {
  let client: EventTelemetryClient | undefined
  // A shutdown that lands before the deferred tick cancels the capture outright: creating the
  // client afterwards would leave an unflushed transport behind the session that owns it.
  let sessionClosed = false

  return {
    name: "omo-native-session",
    register(pi, ctx) {
      void loadEngineTables()
      // Reading the inventory, loading omo config twice and building the PostHog client is ~14 ms of
      // analytics on the session_start dispatch path, and nothing in the session observes it. It
      // runs one tick past the first paint instead, still inside this session.
      const captureSessionStart = (payload: unknown, eventCtx: unknown): void => {
        if (sessionClosed) return
        const env = options.env ?? process.env
        const product = createOmoNativeProductConfig()
        if (!isOmoNativeTelemetryEnabled(options, eventCtx, env)) return

        const osProvider = options.osProvider ?? getDefaultTelemetryOsProvider()
        const sessionId = extractSessionId(eventCtx) ?? "unknown"
        const attribution = getOmoNativeAttribution({ env })
        client = createEventTelemetryClient({
          diagnostics: options.diagnostics,
          distinctId: attribution.install_hash,
          env,
          product: { ...product, additionalProperties: { ...product.additionalProperties, ...attribution } },
          propertyAllowlist: OMO_NATIVE_PROPERTY_ALLOWLISTS,
          schemaVersion: OMO_NATIVE_SCHEMA_VERSION,
          setTimeoutFn: options.setTimeoutFn,
          source: SOURCE,
          transportFactory: options.transportFactory ?? createSenpiTelemetryTransportFactory({
            env,
            consent: () => isOmoNativeTelemetryEnabled(options, eventCtx, env),
            diagnostics: options.diagnostics,
            source: SOURCE,
          }),
        })
        if (!client.enabled) return

        const sessionHash = (options.hashSessionId ?? hashSessionId)(sessionId)
        const activity = getDailyActiveCaptureState({
          diagnostics: options.diagnostics,
          now: options.now,
          stateDir: getOmoNativeStateDir(env),
        })
        if (activity.captureDaily) {
          client.captureEvent("daily_active", {
            $session_id: sessionHash,
            day_utc: activity.dayUTC,
            reason: "session_start",
          })
        }

        const inventory = readOmoNativeInventory(resolveAgentHome({ env }), options.diagnostics)
        const connectedAccounts = readConnectedAccounts(resolveAgentHome({ env }), env)
        const reason = sessionReason(payload)
        const timezone = readTimeZone(options.timeZone)
        client.captureEvent("session_started", {
          $session_id: sessionHash,
          $os: osProvider.platform(),
          $os_version: osProvider.release(),
          arch: osProvider.arch(),
          cpu_count: osProvider.cpus().length,
          memory_bucket: memoryBucket(osProvider.totalmem()),
          provider_count: inventory.providerCount,
          signed_in_provider_count: inventory.signedInProviderCount,
          configured_provider_count: inventory.configuredProviderCount,
          connected_account_count: connectedAccounts,
          model_count: inventory.modelCount,
          providers: inventory.providers,
          reason,
          session_role: resolveTelemetrySessionRole(pi, env),
          ...(timezone === undefined ? {} : { timezone }),
          ...(inventory.defaultProvider === undefined ? {} : { default_provider: inventory.defaultProvider }),
          ...(inventory.defaultModel === undefined ? {} : { default_model: inventory.defaultModel }),
        })

        // The category map is only observable where BOTH the config and the live model registry are
        // in hand. A host that reports no registry (older host, RPC context) simply ships no snapshot
        // rather than a snapshot that guesses availability.
        captureCategoryConfig({
          client,
          eventCtx,
          omoConfig: loadCategoryConfig(options, eventCtx, env),
          reason,
          sessionHash,
        })

        void recordSenpiDailyActive({
          env,
          now: options.now,
          osProvider,
          stateDir: getSenpiTelemetryStateDir(env),
          transportFactory: options.transportFactory,
        }).catch((error: unknown) => {
          ctx.logger.warn("omo-senpi legacy telemetry failed", error)
        })
      }

      pi.on("session_start", (payload, eventCtx) => {
        sessionClosed = false
        deferUntilAfterFirstPaint(ctx, "omo-native session telemetry", () => captureSessionStart(payload, eventCtx))
      })

      pi.on("session_shutdown", async () => {
        sessionClosed = true
        const activeClient = client
        client = undefined
        await activeClient?.shutdown()
      })
    },
  }
}

// Fire-and-forget: an unreadable config or a throwing registry costs the snapshot, never the session.
function captureCategoryConfig(input: {
  readonly client: EventTelemetryClient
  readonly eventCtx: unknown
  readonly omoConfig: OmoConfig | undefined
  readonly reason: string
  readonly sessionHash: string
}): void {
  const registry = resolveSessionModelRegistry(input.eventCtx)
  if (registry === undefined || input.omoConfig === undefined) return
  createCategoryConfigCapture({
    captureEvent: input.client.captureEvent,
    omoConfig: input.omoConfig,
    sessionHash: input.sessionHash,
  }).observe({ registry, source: input.reason })
}

function loadCategoryConfig(
  options: OmoNativeSessionOptions,
  eventCtx: unknown,
  env: TelemetryEnv,
): OmoConfig | undefined {
  const cwd = extractString(eventCtx, "cwd")
  try {
    return loadSenpiOmoConfig({ env: { ...env }, ...(cwd === undefined ? {} : { cwd }) }).config
  } catch (error) {
    options.diagnostics?.({
      event: "telemetry_capture_failed",
      source: SOURCE,
      error,
      errorKind: error instanceof Error ? "error" : "non_error",
    })
    return undefined
  }
}

// A runtime without ICU data (or a host that refuses the lookup) simply ships no timezone.
function readTimeZone(provider: (() => string) | undefined): string | undefined {
  try {
    const zone = (provider ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone))()
    return zone.length > 0 && zone.length <= 64 ? zone : undefined
  } catch {
    return undefined
  }
}

/** The one enablement decision: the env opt-out matrix plus the omo config gate for the event's cwd. */
export function isOmoNativeTelemetryEnabled(
  options: Pick<OmoNativeSessionOptions, "diagnostics" | "isConfigEnabled"> & { readonly automationDeps?: TempDirDeps },
  eventCtx: unknown,
  env: TelemetryEnv,
): boolean {
  return (
    notAutomated(env, options.automationDeps) &&
    isTelemetryClientEnabled({ env, product: createOmoNativeProductConfig() }) &&
    configEnabled(options, eventCtx, env)
  )
}

/** The automation check sits on the consent path, which must never throw: if it cannot decide, telemetry is off. */
function notAutomated(env: TelemetryEnv, deps: TempDirDeps = {}): boolean {
  try {
    return automatedRunReason(env, deps) === undefined
  } catch {
    return false
  }
}

const ALLOW_AUTOMATION_VALUES = ["1", "true", "yes"]

/**
 * Automated runs cannot hold a stable anonymous id (a CI job, a test runner, or a HOME inside the OS temp dir starts
 * from nothing each time), so each one would count as a new person (#10934). Telemetry is off for them by default;
 * `OMO_TELEMETRY_ALLOW_AUTOMATION=1` opts a deliberate run back in.
 */
export function automatedRunReason(
  env: TelemetryEnv,
  deps: TempDirDeps = {},
): "ci" | "test_runner" | "ephemeral_home" | undefined {
  if (ALLOW_AUTOMATION_VALUES.includes(env["OMO_TELEMETRY_ALLOW_AUTOMATION"]?.trim().toLowerCase() ?? "")) return undefined
  const ci = env["CI"]?.trim().toLowerCase() ?? ""
  if (ci !== "" && ci !== "0" && ci !== "false") return "ci"
  if (env["NODE_ENV"]?.trim() === "test" || env["VITEST"] || env["JEST_WORKER_ID"]) return "test_runner"
  const platform = deps.platform ?? process.platform
  const home = (platform === "win32" ? env["USERPROFILE"] : env["HOME"])?.trim()
  if (home && isInsideTempDir(home, env, deps)) return "ephemeral_home"
  return undefined
}

/** What the temp-home check reads from the OS; injected only by tests that simulate another platform or filesystem. */
export type TempDirDeps = PathContainmentOptions & {
  readonly tmpdir?: () => string
  /** The fixed POSIX temp roots checked besides os.tmpdir(); never used on win32. */
  readonly posixTempRoots?: readonly string[]
}

const POSIX_TEMP_ROOTS = ["/tmp", "/private/tmp", "/var/folders", "/private/var/folders"]
const POSIX_USERS_DIRS = ["/Users", "/home", "/var/home"]
const POSIX_ROOT_HOMES = ["/root", "/var/root"]

/**
 * Whether `path` (the HOME being classified) is a home that cannot hold a stable install id (#10934, #10935).
 *
 * - A HOME that cannot be resolved cannot hold anything either: it counts as ephemeral, so the check fails toward
 *   telemetry OFF, never ON.
 * - A real account profile, a direct child of the OS users directory (`/Users/<name>`, `/home/<name>`,
 *   `C:\Users\<name>`) or root's home, is never ephemeral, whatever TMPDIR says (TMPDIR=/, =/Users, =the home).
 *   The account home is taken from the path's shape, not from os.userInfo(): under Bun that reads HOME/USERPROFILE,
 *   the very value being classified.
 * - Otherwise it is ephemeral when it lies inside os.tmpdir() (or a fixed POSIX temp root), decided by the shared
 *   path-containment helper: native realpath on both sides, case-insensitive on win32. A temp root that resolves to
 *   a filesystem root is ignored.
 * - A macOS automount trigger (`/home`, `/net`, outside this HOME) is never resolved: realpath opens it, and a wedged
 *   automounter parks the host loop in that open for good (#11545). Such a candidate is compared lexically instead.
 */
function isInsideTempDir(path: string, env: TelemetryEnv, deps: TempDirDeps): boolean {
  const windows = (deps.platform ?? process.platform) === "win32"
  const paths = windows ? win32 : posix
  const options: PathContainmentOptions = { platform: windows ? "win32" : (deps.platform ?? process.platform), ...(deps.realpath === undefined ? {} : { realpath: deps.realpath }) }
  const realpath = deps.realpath ?? realpathSync.native
  const resolve = (candidate: string): string | undefined => {
    try {
      return paths.normalize(realpath(candidate))
    } catch {
      return undefined
    }
  }
  const same = (left: string, right: string): boolean => {
    try {
      return isPathInside(left, right, options) && isPathInside(right, left, options)
    } catch {
      return false
    }
  }
  // The install id is written under path.join(home, ...), which resolves `..` lexically, so every check below
  // judges that lexically resolved path (the helper's contract for lexical openers), not the raw HOME. A lexical
  // HOME that does not exist yet cannot hold a stable id either: it counts as ephemeral (telemetry OFF).
  const lexical = paths.resolve(path)
  const target = resolve(lexical)
  if (target === undefined) return true
  const trigger = (candidate: string): boolean =>
    !windows && isDarwinAutomountTriggerPath(candidate, { platform: deps.platform ?? process.platform, homeDir: path })
  const lexicallyInside = (candidate: string): boolean => {
    const root = paths.resolve(candidate)
    return paths.dirname(root) !== root && [paths.resolve(path), target].some((home) => home === root || home.startsWith(`${root}${paths.sep}`))
  }
  const usersDirs = windows ? [win32.join(`${env["SystemDrive"]?.trim() || "C:"}\\`, "Users")] : POSIX_USERS_DIRS
  const rootHomes = windows ? [] : POSIX_ROOT_HOMES
  const parent = paths.dirname(target)
  // A trigger is compared lexically, on both the resolved parent and the HOME's own lexical parent: on darwin a home
  // under /home resolves to /System/Volumes/Data/home/<name>, whose parent never equals "/home" (#11547).
  const isUsersDir = (dir: string): boolean =>
    trigger(dir) || trigger(parent) ? parent === dir || paths.dirname(lexical) === dir : same(parent, dir)
  if (usersDirs.some(isUsersDir) || rootHomes.some((home) => same(target, home))) return false
  const candidates = [(deps.tmpdir ?? os.tmpdir)(), ...(windows ? [] : (deps.posixTempRoots ?? POSIX_TEMP_ROOTS))]
  return candidates.some((candidate) => {
    if (trigger(candidate)) return lexicallyInside(candidate)
    const root = resolve(candidate)
    if (root === undefined || paths.dirname(root) === root) return false
    try {
      return isPathInside(lexical, candidate, options)
    } catch {
      return false
    }
  })
}


/**
 * The persisted half of consent: the telemetry setting in the config files, for a scope's cwd. Environment
 * opt-outs are left out on purpose: they belong to one process, while this decides for every process that
 * shares the queue (see `purgeUnconsentedQueue`). For the same reason the config is read with a neutral env:
 * no profile selection and the account's own home, so a config only this process selects (`OMO_PROFILE`,
 * `OCX_PROFILE`, `OPENCODE_CONFIG_DIR`, an overridden `HOME`) cannot judge other sessions' records. A record's
 * own `selection` (the config its writer consented under, #11198) is applied on top, so it is judged by its writer's
 * config, profile included.
 */
export function isOmoNativeTelemetryConfigEnabled(
  options: Pick<OmoNativeSessionOptions, "diagnostics" | "isConfigEnabled">,
  eventCtx: unknown,
  env: TelemetryEnv,
  accountHomeDir: string = userInfo().homedir,
  selection?: ConfigSelection,
): boolean {
  const neutral: Record<string, string | undefined> = { ...env }
  for (const key of CONFIG_SELECTION_ENV_KEYS) delete neutral[key]
  const shared = selection === undefined ? neutral : withConfigSelection(neutral, selection)
  // The account's own home, unless the record names the home its writer read (HOME, or USERPROFILE on Windows).
  if (shared.HOME === undefined && shared.USERPROFILE === undefined) shared.HOME = accountHomeDir
  return configEnabled(options, eventCtx, shared)
}

function configEnabled(
  options: Pick<OmoNativeSessionOptions, "diagnostics" | "isConfigEnabled">,
  eventCtx: unknown,
  env: TelemetryEnv,
): boolean {
  const cwd = extractString(eventCtx, "cwd")
  if (options.isConfigEnabled !== undefined) return options.isConfigEnabled(cwd, env)
  try {
    const loaded = loadSenpiOmoConfig({
      env: { ...env },
      ...(cwd === undefined ? {} : { cwd }),
    })
    if (loaded.diagnostics.length === 0) return isOmoTelemetryEnabled(loaded.config)
    const error = new Error(loaded.diagnostics.map(({ message }) => message).join("; "))
    options.diagnostics?.({ event: "telemetry_capture_failed", source: SOURCE, error, errorKind: "error" })
    return false
  } catch (error) {
    options.diagnostics?.({
      event: "telemetry_capture_failed",
      source: SOURCE,
      error,
      errorKind: error instanceof Error ? "error" : "non_error",
    })
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function sessionReason(payload: unknown): string {
  const reason = extractString(payload, "reason")
  return reason !== undefined && SESSION_REASONS.has(reason) ? reason : "startup"
}

function extractSessionId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const manager = Reflect.get(value, "sessionManager")
  if (!isRecord(manager)) return undefined
  const getSessionId = Reflect.get(manager, "getSessionId")
  if (typeof getSessionId !== "function") return undefined
  const sessionId: unknown = Reflect.apply(getSessionId, manager, [])
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined
}

function extractString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined
  const property = Reflect.get(value, key)
  return typeof property === "string" && property.length > 0 ? property : undefined
}

function memoryBucket(bytes: number): string {
  const gib = bytes / 1024 / 1024 / 1024
  if (gib < 8) return "lt_8_gb"
  if (gib < 16) return "8_15_gb"
  if (gib < 32) return "16_31_gb"
  if (gib < 64) return "32_63_gb"
  return "64_plus_gb"
}
