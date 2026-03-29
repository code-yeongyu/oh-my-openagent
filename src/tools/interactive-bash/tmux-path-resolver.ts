import { spawn } from "bun"

const DEFAULT_EXECUTABLE_CHECK_TIMEOUT_MS = 400
const DEFAULT_CMUX_PING_TIMEOUT_MS = 250
const DEFAULT_CMUX_NOTIFY_CAPABILITY_TIMEOUT_MS = 300
const DEFAULT_TMUX_PANE_CONTROL_TIMEOUT_MS = 250

const CMUX_RELAY_ENDPOINT_PATTERN = /^[^\s/:]+:\d+$/

const TMUX_DISABLE_ENV_KEY = "OH_MY_OPENCODE_DISABLE_TMUX"
const CMUX_DISABLE_ENV_KEY = "OH_MY_OPENCODE_DISABLE_CMUX"

let tmuxPath: string | null = null
let tmuxPathInitialized = false
let tmuxPathInitPromise: Promise<string | null> | null = null

let cmuxPath: string | null = null
let cmuxPathInitialized = false
let cmuxPathInitPromise: Promise<string | null> | null = null

export type CmuxEndpointType = "missing" | "unix" | "relay"
export type CmuxHintStrength = "none" | "weak" | "strong"

export type CmuxProbeFailureKind =
  | "explicit-disable"
  | "missing-binary"
  | "missing-socket"
  | "timeout"
  | "connection-refused"
  | "exit-non-zero"

export type CmuxNotificationCapabilityFailureKind =
  | "explicit-disable"
  | "missing-binary"
  | "timeout"
  | "unsupported-contract"
  | "exit-non-zero"

interface ProbeCommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface ProbeOptions {
  environment?: Record<string, string | undefined>
  timeoutMs?: number
}

export interface TmuxRuntimeProbe {
  path: string | null
  reachable: boolean
  paneControlReachable: boolean
  explicitDisable: boolean
}

export interface CmuxReachabilityProbe {
  path: string | null
  socketPath: string | undefined
  endpointType: CmuxEndpointType
  workspaceId: string | undefined
  surfaceId: string | undefined
  hintStrength: CmuxHintStrength
  reachable: boolean
  explicitDisable: boolean
  failureKind?: CmuxProbeFailureKind
}

export interface CmuxNotificationCapabilityProbe {
  capable: boolean
  explicitDisable: boolean
  failureKind?: CmuxNotificationCapabilityFailureKind
}

export interface CmuxRuntimeProbe extends CmuxReachabilityProbe {
  notifyCapable: boolean
  notifyFailureKind?: CmuxNotificationCapabilityFailureKind
}

function normalizeEnvValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function isTruthyFlag(value: string | undefined): boolean {
  const normalized = normalizeEnvValue(value)
  if (!normalized) return false

  const lower = normalized.toLowerCase()
  return lower === "1" || lower === "true" || lower === "yes" || lower === "on"
}

function toProbeEnvironment(
  environment: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const merged: Record<string, string | undefined> = {
    ...process.env,
    ...(environment ?? {}),
  }

  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === "string") {
      normalized[key] = value
    }
  }
  return normalized
}

export function classifyCmuxEndpoint(endpoint: string | undefined): CmuxEndpointType {
  const normalized = normalizeEnvValue(endpoint)
  if (!normalized) return "missing"

  if (CMUX_RELAY_ENDPOINT_PATTERN.test(normalized)) {
    return "relay"
  }

  return "unix"
}

function resolveCmuxHintStrength(environment: Record<string, string | undefined>): CmuxHintStrength {
  const workspaceId = normalizeEnvValue(environment.CMUX_WORKSPACE_ID)
  const surfaceId = normalizeEnvValue(environment.CMUX_SURFACE_ID)
  if (workspaceId && surfaceId) {
    return "strong"
  }

  const termProgram = normalizeEnvValue(environment.TERM_PROGRAM)
  if (termProgram?.toLowerCase() === "ghostty") {
    return "weak"
  }

  return "none"
}

export function isConnectionRefusedText(value: string): boolean {
  const normalized = value.toLowerCase()
  return normalized.includes("connection refused") || normalized.includes("econnrefused")
}

export function supportsCmuxNotifyFlagModel(helpText: string): boolean {
  const normalized = helpText.toLowerCase()
  return normalized.includes("--title") && normalized.includes("--body")
}

function buildTmuxPaneControlProbeArgs(tmuxBinary: string, paneId: string): string[] {
  return [
    tmuxBinary,
    "display-message",
    "-p",
    "-t",
    paneId,
    "#{pane_id}",
  ]
}

function buildCmuxNotifyProbeArgs(input: {
  cmuxBinary: string
  workspaceId?: string
  surfaceId?: string
}): string[] {
  const args = [
    input.cmuxBinary,
    "notify",
    "--title",
    "capability-probe",
    "--body",
    "capability-probe",
  ]

  if (input.workspaceId) {
    args.push("--workspace", input.workspaceId)
  }

  if (input.surfaceId) {
    args.push("--surface", input.surfaceId)
  }

  args.push("--help")

  return args
}

async function probeTmuxPaneControl(input: {
  tmuxBinary: string
  paneId: string
  environment: Record<string, string | undefined>
  timeoutMs: number
}): Promise<boolean> {
  const probeResult = await runProbeCommand(
    buildTmuxPaneControlProbeArgs(input.tmuxBinary, input.paneId),
    {
      environment: input.environment,
      timeoutMs: input.timeoutMs,
    },
  )

  if (probeResult.timedOut || probeResult.exitCode !== 0) {
    return false
  }

  const resolvedPaneId = normalizeEnvValue(probeResult.stdout)
  return resolvedPaneId === input.paneId
}

async function runProbeCommand(
  args: string[],
  options: {
    environment?: Record<string, string | undefined>
    timeoutMs?: number
  } = {},
): Promise<ProbeCommandResult> {
  try {
    const proc = spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      env: toProbeEnvironment(options.environment),
    })

    const timeoutMs = options.timeoutMs ?? DEFAULT_EXECUTABLE_CHECK_TIMEOUT_MS
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined

    const timedOut = await Promise.race([
      proc.exited.then(() => false).catch(() => false),
      new Promise<boolean>((resolve) => {
        timeoutHandle = setTimeout(() => {
          try {
            proc.kill()
          } catch {
            // ignore
          }
          resolve(true)
        }, timeoutMs)
      }),
    ])

    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }

    const exitCode = timedOut ? null : await proc.exited.catch(() => null)
    const stdout = await new Response(proc.stdout).text().catch(() => "")
    const stderr = await new Response(proc.stderr).text().catch(() => "")

    return {
      exitCode,
      stdout,
      stderr,
      timedOut,
    }
  } catch {
    return {
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
    }
  }
}

function findCommandPath(
  commandName: string,
  environment?: Record<string, string | undefined>,
): string | null {
  try {
    const probeEnvironment = toProbeEnvironment(environment)
    const whichOptions =
      probeEnvironment.PATH !== undefined
        ? { PATH: probeEnvironment.PATH }
        : undefined

    const discovered = Bun.which(commandName, whichOptions)
    return discovered ?? null
  } catch {
    return null
  }
}

async function resolveExecutablePath(
  commandName: string,
  verifyArgs: string[],
  environment?: Record<string, string | undefined>,
): Promise<string | null> {
  const discovered = findCommandPath(commandName, environment)
  if (!discovered) {
    return null
  }

  const verification = await runProbeCommand([discovered, ...verifyArgs], {
    environment,
  })
  if (verification.timedOut || verification.exitCode !== 0) {
    return null
  }

  return discovered
}

async function findTmuxPath(environment: Record<string, string | undefined> = process.env): Promise<string | null> {
  if (isTruthyFlag(environment[TMUX_DISABLE_ENV_KEY])) {
    return null
  }

  return resolveExecutablePath("tmux", ["-V"], environment)
}

async function findCmuxPath(environment: Record<string, string | undefined> = process.env): Promise<string | null> {
  if (isTruthyFlag(environment[CMUX_DISABLE_ENV_KEY])) {
    return null
  }

  return resolveExecutablePath("cmux", ["--help"], environment)
}

export async function getTmuxPath(): Promise<string | null> {
  if (tmuxPathInitialized) {
    return tmuxPath
  }

  if (tmuxPathInitPromise) {
    return tmuxPathInitPromise
  }

  tmuxPathInitPromise = (async () => {
    const path = await findTmuxPath()
    tmuxPath = path
    tmuxPathInitialized = true
    return path
  })()

  return tmuxPathInitPromise
}

export function getCachedTmuxPath(): string | null {
  return tmuxPath
}

export async function getCmuxPath(): Promise<string | null> {
  if (cmuxPathInitialized) {
    return cmuxPath
  }

  if (cmuxPathInitPromise) {
    return cmuxPathInitPromise
  }

  cmuxPathInitPromise = (async () => {
    const path = await findCmuxPath()
    cmuxPath = path
    cmuxPathInitialized = true
    return path
  })()

  return cmuxPathInitPromise
}

export function getCachedCmuxPath(): string | null {
  return cmuxPath
}

export async function probeTmuxRuntime(options: ProbeOptions = {}): Promise<TmuxRuntimeProbe> {
  const environment = options.environment ?? process.env
  if (isTruthyFlag(environment[TMUX_DISABLE_ENV_KEY])) {
    return {
      path: null,
      reachable: false,
      paneControlReachable: false,
      explicitDisable: true,
    }
  }

  const path = options.environment
    ? await findTmuxPath(environment)
    : await getTmuxPath()
  const paneId = normalizeEnvValue(environment.TMUX_PANE)
  const hasTmuxEnvironment = Boolean(normalizeEnvValue(environment.TMUX))

  if (!path || !hasTmuxEnvironment || !paneId) {
    return {
      path,
      reachable: Boolean(path),
      paneControlReachable: false,
      explicitDisable: false,
    }
  }

  const paneControlReachable = await probeTmuxPaneControl({
    tmuxBinary: path,
    paneId,
    environment,
    timeoutMs: options.timeoutMs ?? DEFAULT_TMUX_PANE_CONTROL_TIMEOUT_MS,
  })

  return {
    path,
    reachable: Boolean(path),
    paneControlReachable,
    explicitDisable: false,
  }
}

function classifyCmuxProbeFailureKind(result: ProbeCommandResult): CmuxProbeFailureKind {
  const combinedOutput = `${result.stderr}\n${result.stdout}`
  return isConnectionRefusedText(combinedOutput)
    ? "connection-refused"
    : "exit-non-zero"
}

export async function probeCmuxReachability(options: ProbeOptions = {}): Promise<CmuxReachabilityProbe> {
  const environment = options.environment ?? process.env
  const socketPath = normalizeEnvValue(environment.CMUX_SOCKET_PATH)
  const endpointType = classifyCmuxEndpoint(socketPath)
  const workspaceId = normalizeEnvValue(environment.CMUX_WORKSPACE_ID)
  const surfaceId = normalizeEnvValue(environment.CMUX_SURFACE_ID)
  const hintStrength = resolveCmuxHintStrength(environment)

  if (isTruthyFlag(environment[CMUX_DISABLE_ENV_KEY])) {
    return {
      path: null,
      socketPath,
      endpointType,
      workspaceId,
      surfaceId,
      hintStrength,
      reachable: false,
      explicitDisable: true,
      failureKind: "explicit-disable",
    }
  }

  const path = options.environment
    ? await findCmuxPath(environment)
    : await getCmuxPath()
  if (!path) {
    return {
      path: null,
      socketPath,
      endpointType,
      workspaceId,
      surfaceId,
      hintStrength,
      reachable: false,
      explicitDisable: false,
      failureKind: "missing-binary",
    }
  }

  if (!socketPath) {
    return {
      path,
      socketPath,
      endpointType,
      workspaceId,
      surfaceId,
      hintStrength,
      reachable: false,
      explicitDisable: false,
      failureKind: "missing-socket",
    }
  }

  const probeResult = await runProbeCommand([path, "ping"], {
    environment,
    timeoutMs: options.timeoutMs ?? DEFAULT_CMUX_PING_TIMEOUT_MS,
  })

  let effectiveProbeResult = probeResult

  const firstFailureKind = classifyCmuxProbeFailureKind(probeResult)
  if (
    !probeResult.timedOut
    && probeResult.exitCode !== 0
    && endpointType === "relay"
    && firstFailureKind === "connection-refused"
  ) {
    effectiveProbeResult = await runProbeCommand([path, "ping"], {
      environment,
      timeoutMs: options.timeoutMs ?? DEFAULT_CMUX_PING_TIMEOUT_MS,
    })
  }

  if (effectiveProbeResult.timedOut) {
    return {
      path,
      socketPath,
      endpointType,
      workspaceId,
      surfaceId,
      hintStrength,
      reachable: false,
      explicitDisable: false,
      failureKind: "timeout",
    }
  }

  if (effectiveProbeResult.exitCode !== 0) {
    const failureKind = classifyCmuxProbeFailureKind(effectiveProbeResult)

    return {
      path,
      socketPath,
      endpointType,
      workspaceId,
      surfaceId,
      hintStrength,
      reachable: false,
      explicitDisable: false,
      failureKind,
    }
  }

  return {
    path,
    socketPath,
    endpointType,
    workspaceId,
    surfaceId,
    hintStrength,
    reachable: true,
    explicitDisable: false,
  }
}

export async function probeCmuxNotificationCapability(
  options: ProbeOptions & {
    cmuxPath?: string | null
    workspaceId?: string
    surfaceId?: string
  } = {},
): Promise<CmuxNotificationCapabilityProbe> {
  const environment = options.environment ?? process.env

  if (isTruthyFlag(environment[CMUX_DISABLE_ENV_KEY])) {
    return {
      capable: false,
      explicitDisable: true,
      failureKind: "explicit-disable",
    }
  }

  const cmuxBinary = options.cmuxPath
    ?? (options.environment ? await findCmuxPath(environment) : await getCmuxPath())
  if (!cmuxBinary) {
    return {
      capable: false,
      explicitDisable: false,
      failureKind: "missing-binary",
    }
  }

  const probeResult = await runProbeCommand(buildCmuxNotifyProbeArgs({
    cmuxBinary,
    workspaceId: normalizeEnvValue(options.workspaceId),
    surfaceId: normalizeEnvValue(options.surfaceId),
  }), {
    environment,
    timeoutMs: options.timeoutMs ?? DEFAULT_CMUX_NOTIFY_CAPABILITY_TIMEOUT_MS,
  })

  if (probeResult.timedOut) {
    return {
      capable: false,
      explicitDisable: false,
      failureKind: "timeout",
    }
  }

  if (probeResult.exitCode !== 0) {
    return {
      capable: false,
      explicitDisable: false,
      failureKind: "exit-non-zero",
    }
  }

  const helpOutput = `${probeResult.stdout}\n${probeResult.stderr}`
  if (!supportsCmuxNotifyFlagModel(helpOutput)) {
    return {
      capable: false,
      explicitDisable: false,
      failureKind: "unsupported-contract",
    }
  }

  return {
    capable: true,
    explicitDisable: false,
  }
}

export async function probeCmuxRuntime(options: ProbeOptions = {}): Promise<CmuxRuntimeProbe> {
  const reachability = await probeCmuxReachability(options)
  const capability = await probeCmuxNotificationCapability({
    ...options,
    cmuxPath: reachability.path,
    workspaceId: reachability.workspaceId,
    surfaceId: reachability.surfaceId,
  })

  return {
    ...reachability,
    notifyCapable: capability.capable,
    notifyFailureKind: capability.failureKind,
  }
}

export function startBackgroundCheck(): void {
  if (!tmuxPathInitPromise) {
    tmuxPathInitPromise = getTmuxPath()
    tmuxPathInitPromise.catch(() => {})
  }
  if (!cmuxPathInitPromise) {
    cmuxPathInitPromise = getCmuxPath()
    cmuxPathInitPromise.catch(() => {})
  }
}

export function resetMultiplexerPathCacheForTesting(): void {
  tmuxPath = null
  tmuxPathInitialized = false
  tmuxPathInitPromise = null

  cmuxPath = null
  cmuxPathInitialized = false
  cmuxPathInitPromise = null
}
