import {
  probeCmuxRuntime,
  probeTmuxRuntime,
  type CmuxRuntimeProbe,
  type CmuxEndpointType,
  type CmuxHintStrength,
  type TmuxRuntimeProbe,
} from "../../../tools/interactive-bash/tmux-path-resolver"

export type MultiplexerMode = "cmux-shim" | "tmux-only" | "cmux-notify-only" | "none"
export type PaneBackend = "tmux" | "none"
export type NotificationBackend = "cmux" | "desktop"

export interface ResolvedTmuxRuntime {
  path: string | null
  reachable: boolean
  insideEnvironment: boolean
  paneId: string | undefined
  explicitDisable: boolean
}

export interface ResolvedCmuxRuntime {
  path: string | null
  reachable: boolean
  notifyCapable: boolean
  socketPath: string | undefined
  endpointType: CmuxEndpointType
  workspaceId: string | undefined
  surfaceId: string | undefined
  hintStrength: CmuxHintStrength
  explicitDisable: boolean
}

export interface ResolvedMultiplexer {
  platform: NodeJS.Platform
  mode: MultiplexerMode
  paneBackend: PaneBackend
  notificationBackend: NotificationBackend
  tmux: ResolvedTmuxRuntime
  cmux: ResolvedCmuxRuntime
}

export interface ResolveMultiplexerRuntimeOptions {
  environment?: Record<string, string | undefined>
  platform?: NodeJS.Platform
  tmuxEnabled?: boolean
  cmuxEnabled?: boolean
  tmuxProbe?: TmuxRuntimeProbe
  cmuxProbe?: CmuxRuntimeProbe
}

function normalizeEnvValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function isInsideTmuxEnvironment(environment: Record<string, string | undefined>): boolean {
  return Boolean(normalizeEnvValue(environment.TMUX))
}

function resolveMode(input: {
  hasLiveTmuxPaneControl: boolean
  hasLiveCmuxRuntime: boolean
}): MultiplexerMode {
  if (input.hasLiveCmuxRuntime && input.hasLiveTmuxPaneControl) {
    return "cmux-shim"
  }

  if (input.hasLiveTmuxPaneControl) {
    return "tmux-only"
  }

  if (input.hasLiveCmuxRuntime) {
    return "cmux-notify-only"
  }

  return "none"
}

function createDisabledTmuxProbe(): TmuxRuntimeProbe {
  return {
    path: null,
    reachable: false,
    paneControlReachable: false,
    explicitDisable: false,
  }
}

function createDisabledCmuxProbe(): CmuxRuntimeProbe {
  return {
    path: null,
    socketPath: undefined,
    endpointType: "missing",
    workspaceId: undefined,
    surfaceId: undefined,
    hintStrength: "none",
    reachable: false,
    explicitDisable: false,
    notifyCapable: false,
  }
}

export function createDisabledMultiplexerRuntime(platform: NodeJS.Platform = process.platform): ResolvedMultiplexer {
  return {
    platform,
    mode: "none",
    paneBackend: "none",
    notificationBackend: "desktop",
    tmux: {
      path: null,
      reachable: false,
      insideEnvironment: false,
      paneId: undefined,
      explicitDisable: false,
    },
    cmux: {
      path: null,
      reachable: false,
      notifyCapable: false,
      socketPath: undefined,
      endpointType: "missing",
      workspaceId: undefined,
      surfaceId: undefined,
      hintStrength: "none",
      explicitDisable: false,
    },
  }
}

export function resolveMultiplexerFromProbes(args: {
  platform: NodeJS.Platform
  environment: Record<string, string | undefined>
  tmuxEnabled: boolean
  cmuxEnabled: boolean
  tmuxProbe: TmuxRuntimeProbe
  cmuxProbe: CmuxRuntimeProbe
}): ResolvedMultiplexer {
  const insideTmux = isInsideTmuxEnvironment(args.environment)
  const paneId = normalizeEnvValue(args.environment.TMUX_PANE)

  const hasLiveTmuxPaneControl =
    args.tmuxEnabled
    && !args.tmuxProbe.explicitDisable
    && args.tmuxProbe.paneControlReachable
    && insideTmux

  const hasLiveCmuxRuntime =
    args.cmuxEnabled
    && !args.cmuxProbe.explicitDisable
    && args.cmuxProbe.reachable

  const mode = resolveMode({
    hasLiveTmuxPaneControl,
    hasLiveCmuxRuntime,
  })

  const paneBackend: PaneBackend = hasLiveTmuxPaneControl ? "tmux" : "none"
  const notificationBackend: NotificationBackend =
    hasLiveCmuxRuntime && args.cmuxProbe.notifyCapable
      ? "cmux"
      : "desktop"

  return {
    platform: args.platform,
    mode,
    paneBackend,
    notificationBackend,
    tmux: {
      path: args.tmuxProbe.path,
      reachable: hasLiveTmuxPaneControl,
      insideEnvironment: insideTmux,
      paneId,
      explicitDisable: args.tmuxProbe.explicitDisable,
    },
    cmux: {
      path: args.cmuxProbe.path,
      reachable: hasLiveCmuxRuntime,
      notifyCapable: args.cmuxProbe.notifyCapable,
      socketPath: args.cmuxProbe.socketPath,
      endpointType: args.cmuxProbe.endpointType,
      workspaceId: args.cmuxProbe.workspaceId,
      surfaceId: args.cmuxProbe.surfaceId,
      hintStrength: args.cmuxProbe.hintStrength,
      explicitDisable: args.cmuxProbe.explicitDisable,
    },
  }
}

let resolvedMultiplexerRuntime: ResolvedMultiplexer | null = null

export async function resolveMultiplexerRuntime(
  options: ResolveMultiplexerRuntimeOptions = {},
): Promise<ResolvedMultiplexer> {
  const environment = options.environment ?? process.env
  const platform = options.platform ?? process.platform
  const tmuxEnabled = options.tmuxEnabled ?? true
  const cmuxEnabled = options.cmuxEnabled ?? true

  const tmuxProbePromise = options.tmuxProbe
    ? Promise.resolve(options.tmuxProbe)
    : tmuxEnabled
      ? probeTmuxRuntime({ environment })
      : Promise.resolve(createDisabledTmuxProbe())

  const cmuxProbePromise = options.cmuxProbe
    ? Promise.resolve(options.cmuxProbe)
    : cmuxEnabled
      ? probeCmuxRuntime({ environment })
      : Promise.resolve(createDisabledCmuxProbe())

  const [tmuxProbe, cmuxProbe] = await Promise.all([tmuxProbePromise, cmuxProbePromise])

  const resolved = resolveMultiplexerFromProbes({
    platform,
    environment,
    tmuxEnabled,
    cmuxEnabled,
    tmuxProbe,
    cmuxProbe,
  })

  return resolved
}

export function setResolvedMultiplexerRuntime(runtime: ResolvedMultiplexer): void {
  resolvedMultiplexerRuntime = runtime
}

export function getResolvedMultiplexerRuntime(): ResolvedMultiplexer | null {
  return resolvedMultiplexerRuntime
}

export function resetResolvedMultiplexerRuntimeForTesting(): void {
  resolvedMultiplexerRuntime = null
}
