/**
 * The senpi `pi.*` seams omo feature-detects (#12861). Every guard in this package that probes the host
 * (`typeof pi.X`, `pi.X === undefined`, `pi.X?.`, `"X" in pi`, `pi.X ?? fallback`, `if (pi.X)`, `!pi.X`, `pi.X && ...`) degrades a feature silently when the seam is
 * missing, so each one is listed here: `senpi-seams.test.ts` scans the guard sites and fails when one is not
 * listed, and checks this list against the pinned `@code-yeongyu/senpi` package's real ExtensionAPI.
 *
 * A nested entry (`rpc.handle`) is a member read behind an optional parent (`pi.rpc?.handle`).
 */
export type SenpiSeamKind = "function" | "object" | "string" | "property"

export const SENPI_SEAMS = {
  appendEntry: "function",
  cwd: "string",
  events: "object",
  "events.emit": "function",
  "events.on": "function",
  getAllTools: "function",
  getCommands: "function",
  getPermissionPreset: "function",
  getSessionName: "function",
  hostVersion: "string",
  lifecycle: "object",
  "lifecycle.markRunCompleted": "function",
  on: "function",
  provideEvalHandleHost: "function",
  registerMcpServer: "function",
  registerMemoryReporter: "function",
  registerMessageRenderer: "function",
  registerReadClassifier: "function",
  registerRemovedToolHint: "function",
  registerTool: "function",
  rpc: "object",
  "rpc.emit": "function",
  "rpc.handle": "function",
  sessionContext: "property",
  setSessionThinkingLevel: "function",
} as const satisfies Readonly<Record<string, SenpiSeamKind>>

function seamPresent(surface: unknown, path: string, kind: SenpiSeamKind): boolean {
  let holder: unknown = surface
  const keys = path.split(".")
  const last = keys.pop()
  for (const key of keys) holder = typeof holder === "object" && holder !== null ? Reflect.get(holder, key) : undefined
  if (last === undefined || typeof holder !== "object" || holder === null) return false
  if (kind === "property") return last in holder
  const value: unknown = Reflect.get(holder, last)
  return kind === "object" ? typeof value === "object" && value !== null : typeof value === kind
}

export function absentSenpiSeams(
  surface: unknown,
  seams: Readonly<Record<string, SenpiSeamKind>> = SENPI_SEAMS,
): string[] {
  return Object.entries(seams)
    .filter(([path, kind]) => !seamPresent(surface, path, kind))
    .map(([path]) => path)
}

export function absentSenpiSeamsNotice(surface: unknown): string | undefined {
  const absent = absentSenpiSeams(surface)
  if (absent.length === 0) return undefined
  const version = typeof surface === "object" && surface !== null ? Reflect.get(surface, "hostVersion") : undefined
  return `omo-senpi: senpi ${typeof version === "string" ? version : "(unknown version)"} lacks seams omo uses, those features are off: ${absent.join(", ")}`
}

/**
 * The remote-wake seam: senpi serves `monitor({type: "rpc", target: "<device>/<session>"})` through a source an
 * extension registers here. A senpi without it reads such a target as a local session id and the monitor never wakes.
 */
export const REMOTE_WAKE_SEAM = "registerRpcRemoteSource"
export const REMOTE_WAKE_UNAVAILABLE = "remote_wake_unavailable"

// senpi's remote-target shape (rpc-monitor-targets.ts `parseRpcTarget`, from 2026.11.6-2): one `/`, no leading `/`,
// not a `.jsonl` path, not a drive letter. A senpi without the seam resolves every such target locally, so the
// refusal must never catch a local path: a first segment only a path can have (`.`, `..`, `.hidden`, `~`, `~user`)
// and a `.jsonl` file in any case stay local even where senpi's own shape would call them remote.
const REMOTE_TARGET = /^([^/]+)\/[^/]+$/
const DRIVE_LETTER = /^[A-Za-z]:$/
const PATH_SEGMENT = /^[.~]/

function isRemoteMonitorTarget(target: string): boolean {
  const trimmed = target.trim()
  const device = REMOTE_TARGET.exec(trimmed)?.[1]
  return device !== undefined && !/\.jsonl$/i.test(trimmed) && !DRIVE_LETTER.test(device) && !PATH_SEGMENT.test(device)
}

function remoteWakeUnavailable(
  surface: unknown,
  target: string,
): { readonly code: typeof REMOTE_WAKE_UNAVAILABLE; readonly message: string } | undefined {
  if (!isRemoteMonitorTarget(target) || seamPresent(surface, REMOTE_WAKE_SEAM, "function")) return undefined
  return {
    code: REMOTE_WAKE_UNAVAILABLE,
    message: `${REMOTE_WAKE_UNAVAILABLE}: monitor target "${target.trim()}" is a session on another device, and this senpi has no ${REMOTE_WAKE_SEAM} seam, so the monitor would never wake. Use a senpi with that seam, or check the session yourself.`,
  }
}

/**
 * Refuses the `monitor` tool call that would open an rpc watch on a remote session target while the remote-wake
 * seam is absent, so the agent gets `remote_wake_unavailable` instead of "Monitor started" and a watch that never
 * fires. Registers nothing when the seam is present.
 */
export function installRemoteWakeRefusal(pi: {
  on(event: string, handler: (payload: unknown) => unknown): void
}): void {
  if (seamPresent(pi, REMOTE_WAKE_SEAM, "function")) return
  pi.on("tool_call", (payload) => {
    if (typeof payload !== "object" || payload === null || Reflect.get(payload, "toolName") !== "monitor")
      return undefined
    const input: unknown = Reflect.get(payload, "input")
    if (typeof input !== "object" || input === null) return undefined
    const action: unknown = Reflect.get(input, "action")
    const type: unknown = Reflect.get(input, "type")
    const target: unknown = Reflect.get(input, "target")
    if (
      (action !== undefined && action !== "create") ||
      (type !== undefined && type !== "rpc") ||
      typeof target !== "string"
    )
      return undefined
    const refusal = remoteWakeUnavailable(pi, target)
    return refusal === undefined ? undefined : { block: true, reason: refusal.message }
  })
}
