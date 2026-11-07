/**
 * Herdr backend core (terminal multiplexer, https://herdr.dev).
 *
 * omo's tmux layer is a *visualization* surface: panes run `opencode attach`.
 * On the herdr backend the same visualization maps to one Herdr workspace per
 * team with one tab per member, driven through Herdr's JSON control surface
 * (`{"id","result"|"error"}` envelopes) instead of tmux formats.
 *
 * Contract notes verified against herdr v0.9.5:
 * - control commands answer a JSON envelope; `pane read` prints plain text
 *   and `pane run`/`server stop` acknowledge silently (no envelope)
 * - a down server answers `server_not_running`; the headless `herdr server`
 *   daemonizes the pane runtime and is spawned detached on demand
 * - tab creation must always pin `--workspace` (the focused workspace belongs
 *   to the user); tab ids are NOT derivable from pane ids
 * - pane/workspace ids are alphanumeric past w9 (wA, wB, ...)
 * - the live-agent inventory (`agent list`) is the liveness authority: names
 *   clear when agents exit, so absence is provable death
 */

import { existsSync, statSync } from "node:fs"
import { delimiter, join } from "node:path"
import { spawn } from "@oh-my-opencode/utils/runtime"
import { createPaneAuthHandoff } from "../pane-auth"

export const HERDR_TEAM_WORKSPACE_LABEL_PREFIX = "omo-team-"

/** Subagent panes get their own workspaces, mirroring tmux's `omo-agents-<pid>` sessions. */
export const HERDR_AGENTS_WORKSPACE_LABEL_PREFIX = "omo-agents-"

const HERDR_DEFAULT_EXEC_TIMEOUT_MS = 20_000
const HERDR_SERVER_START_TIMEOUT_MS = 30_000
const HERDR_SERVER_POLL_INTERVAL_MS = 250

export type HerdrExecResult = {
  readonly success: boolean
  readonly output: string
  readonly error?: string
  readonly code?: string
}

export type HerdrExecOptions = {
  readonly timeoutMs?: number
  readonly env?: Record<string, string | undefined>
}

export type RunHerdrCommand = (
  args: ReadonlyArray<string>,
  options?: HerdrExecOptions,
) => Promise<HerdrExecResult>

export type EnsureHerdrServerDeps = {
  readonly runHerdrCommand: RunHerdrCommand
  readonly spawnDetached: (bin: string, args: ReadonlyArray<string>) => void
  readonly sleep: (ms: number) => Promise<void>
}

/** Herdr pane ids look like `wN:pM` (workspace-qualified, alphanumeric past w9). */
export function isHerdrPaneId(value: string | undefined | null): boolean {
  return typeof value === "string" && /^w[0-9a-z]+:p[0-9a-z]+$/i.test(value.trim())
}

export function herdrWorkspaceIdFromPaneId(paneId: string): string {
  const separator = paneId.indexOf(":")
  if (separator <= 0 || separator === paneId.length - 1) {
    throw new Error(`not a herdr pane id: ${paneId}`)
  }
  return paneId.slice(0, separator)
}

/**
 * Resolve the herdr binary. HERDR_BIN_PATH wins when it is an absolute path
 * to an existing file (trust-pinning); otherwise the plain `herdr` name is
 * resolved by PATH, mirroring how tmux is invoked today.
 */
export function resolveHerdrBinary(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const pinned = env["HERDR_BIN_PATH"]?.trim()
  if (pinned && pinned.startsWith("/") && exists(pinned)) return pinned
  return "herdr"
}

function exists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Synchronous eligibility probe for the herdr backend: is a herdr binary
 * reachable at all? A pinned HERDR_BIN_PATH must exist; otherwise the plain
 * `herdr` name must resolve on PATH. This gates the multiplexer=herdr paths
 * the same way `isNativeTmux` gates the tmux ones (no tmux session required).
 */
export function isHerdrBinaryCallable(env: Record<string, string | undefined> = process.env): boolean {
  const pinned = env["HERDR_BIN_PATH"]?.trim()
  if (pinned && pinned.startsWith("/")) return exists(pinned)
  for (const dir of (env["PATH"] ?? "").split(delimiter)) {
    if (dir.length === 0) continue
    if (exists(join(dir, "herdr"))) return true
  }
  return false
}

export function parseHerdrEnvelope(stdout: string):
  | { kind: "ok"; result?: unknown }
  | { kind: "error"; code: string; message: string } {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return { kind: "ok" }
  try {
    const parsed = JSON.parse(trimmed) as { result?: unknown; error?: { code?: string; message?: string } }
    if (parsed && typeof parsed === "object") {
      if (parsed.error) {
        return { kind: "error", code: parsed.error.code ?? "error", message: parsed.error.message ?? "herdr command failed" }
      }
      return { kind: "ok", result: parsed.result }
    }
  } catch {
    // Non-JSON output is treated as raw text (text-surface commands).
  }
  return { kind: "ok" }
}

function extractError(stderr: string): { code: string; message: string } | null {
  const trimmed = stderr.trim()
  if (trimmed.length === 0) return null
  try {
    const parsed = JSON.parse(trimmed) as { error?: { code?: string; message?: string } }
    if (parsed?.error) {
      return { code: parsed.error.code ?? "error", message: parsed.error.message ?? "herdr command failed" }
    }
  } catch {
    // non-JSON stderr
  }
  return null
}

/**
 * Default exec implementation: argv array only (never a shell), stderr
 * decoded as a JSON error envelope when possible.
 */
export const runHerdrCommandDefault: RunHerdrCommand = async (args, options = {}) => {
  const bin = resolveHerdrBinary(options.env)
  if (bin === null) {
    return { success: false, output: "", error: "herdr binary not found", code: "binary_missing" }
  }
  try {
    const subprocess = spawn([bin, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
    })
    const stdoutPromise = new Response(subprocess.stdout).text()
    const stderrPromise = new Response(subprocess.stderr).text()
    const timeoutMs = options.timeoutMs ?? HERDR_DEFAULT_EXEC_TIMEOUT_MS
    const abortController = new AbortController()
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const exitCodeOrTimeout = await Promise.race<number | "timeout">([
      subprocess.exited,
      new Promise<"timeout">((resolve) => {
        // cleared once the race settles so a fast exit never leaves the
        // timer holding the event loop for the full timeout window
        timeoutHandle = setTimeout(() => {
          abortController.abort()
          resolve("timeout")
        }, timeoutMs)
      }),
    ])
    clearTimeout(timeoutHandle)
    if (exitCodeOrTimeout === "timeout") {
      void subprocess.exited.catch(() => undefined)
      void stdoutPromise.catch(() => "")
      void stderrPromise.catch(() => "")
      return { success: false, output: "", error: `herdr timed out after ${timeoutMs}ms`, code: "timeout" }
    }
    const exitCode = exitCodeOrTimeout
    const stdout = await stdoutPromise
    const stderr = await stderrPromise
    if (exitCode !== 0) {
      const detail = extractError(stderr)
      return {
        success: false,
        output: stdout,
        error: detail?.message ?? (stderr.trim() || `herdr exited with code ${exitCode}`),
        code: detail?.code,
      }
    }
    const envelope = parseHerdrEnvelope(stdout)
    if (envelope.kind === "error") {
      return { success: false, output: stdout, error: envelope.message, code: envelope.code }
    }
    return { success: true, output: stdout }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, output: "", error: message, code: message.includes("ENOENT") ? "binary_missing" : "spawn_failed" }
  }
}

/**
 * Ensure a Herdr server owns the socket: probe with a cheap control command,
 * spawn the headless `herdr server` detached on `server_not_running`, and
 * poll until commands answer. Panes then outlive the omo process, which is
 * the Herdr model.
 */
export async function ensureHerdrServer(
  deps: EnsureHerdrServer = {
    runHerdrCommand: runHerdrCommandDefault,
    spawnDetached: (bin, args) => {
      const child = spawn([bin, ...args], { stdout: "ignore", stderr: "ignore", detached: true })
      child.unref()
      void child.exited.catch(() => undefined)
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
): Promise<"running" | "started"> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const probe = await deps.runHerdrCommand(["agent", "list"])
    if (probe.success) return "running"
    if (probe.code !== "server_not_running" && probe.error?.includes("server_not_running") === false) {
      if (probe.code === "binary_missing") {
        throw new Error("herdr binary not found; install from https://herdr.dev or set HERDR_BIN_PATH")
      }
      // Any other failure while the server answers means a genuinely broken
      // command - do not paper over it with a server restart.
      if (probe.code !== undefined) throw new Error(probe.error ?? "herdr probe failed")
    }
    if (attempt > 0) break
    const bin = resolveHerdrBinary()
    if (bin === null) throw new Error("herdr binary not found")
    deps.spawnDetached(bin, ["server"])
    const deadline = Date.now() + HERDR_SERVER_START_TIMEOUT_MS
    while (Date.now() < deadline) {
      await deps.sleep(HERDR_SERVER_POLL_INTERVAL_MS)
      const reprobe = await deps.runHerdrCommand(["agent", "list"])
      if (reprobe.success) return "started"
    }
  }
  throw new Error("herdr server did not become ready in time")
}

export type EnsureHerdrServer = EnsureHerdrServerDeps

export type HerdrWorkspaceCreated = {
  readonly workspaceId: string
  readonly rootPaneId: string
}

export type HerdrTabCreated = {
  readonly paneId: string
  readonly tabId: string
}

export type HerdrOpsDeps = {
  readonly runHerdrCommand: RunHerdrCommand
  readonly ensureServer: () => Promise<"running" | "started">
}

export const defaultHerdrOpsDeps: HerdrOpsDeps = {
  runHerdrCommand: runHerdrCommandDefault,
  ensureServer: () => ensureHerdrServer(),
}

function parseEnvelopeResult<T>(result: HerdrExecResult): T | null {
  if (!result.success) {
    throw new Error(result.error ?? "herdr command failed")
  }
  const envelope = JSON.parse(result.output.trim() || "{}") as { result?: T }
  return envelope.result ?? null
}

/** Create the team workspace; members become tabs inside it. */
export async function herdrCreateWorkspace(
  cwd: string,
  label: string,
  deps: HerdrOpsDeps = defaultHerdrOpsDeps,
): Promise<HerdrWorkspaceCreated> {
  await deps.ensureServer()
  const result = await deps.runHerdrCommand([
    "workspace", "create", "--cwd", cwd, "--label", label, "--no-focus",
  ])
  const created = parseEnvelopeResult<{ workspace?: { workspace_id?: string }; root_pane?: { pane_id?: string } }>(result)
  const workspaceId = created?.workspace?.workspace_id
  const rootPaneId = created?.root_pane?.pane_id
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    throw new Error("herdr workspace create did not return workspace_id")
  }
  return { workspaceId, rootPaneId: typeof rootPaneId === "string" ? rootPaneId : "" }
}

/** One tab per member, pinned to the team workspace. */
export async function herdrCreateTab(
  workspaceId: string,
  cwd: string,
  label: string,
  env: Record<string, string> = {},
  deps: HerdrOpsDeps = defaultHerdrOpsDeps,
): Promise<HerdrTabCreated> {
  const args = ["tab", "create", "--workspace", workspaceId, "--cwd", cwd, "--label", label]
  for (const [key, value] of Object.entries(env)) {
    args.push("--env", `${key}=${value}`)
  }
  args.push("--no-focus")
  const result = await deps.runHerdrCommand(args)
  const created = parseEnvelopeResult<{ tab?: { tab_id?: string }; root_pane?: { pane_id?: string } }>(result)
  const paneId = created?.root_pane?.pane_id
  if (typeof paneId !== "string" || paneId.length === 0) {
    throw new Error("herdr tab create did not return root_pane.pane_id")
  }
  return { paneId, tabId: typeof created?.tab?.tab_id === "string" ? created.tab.tab_id : "" }
}

/**
 * Deliver a shell command (the `opencode attach ...` line) into a pane.
 * `pane run` acknowledges admission silently - no JSON envelope.
 */
export async function herdrRunPaneCommand(
  paneId: string,
  command: string,
  deps: HerdrOpsDeps = defaultHerdrOpsDeps,
): Promise<void> {
  const result = await deps.runHerdrCommand(["pane", "run", paneId, command])
  if (!result.success) throw new Error(result.error ?? "herdr pane run failed")
}

/** Read pane output as plain text (`--source recent-unwrapped` joins wraps). */
export async function herdrReadPane(
  paneId: string,
  lines = 80,
  deps: HerdrOpsDeps = defaultHerdrOpsDeps,
): Promise<string> {
  const result = await deps.runHerdrCommand([
    "pane", "read", paneId, "--source", "recent-unwrapped", "--lines", String(lines),
  ])
  if (!result.success) throw new Error(result.error ?? "herdr pane read failed")
  return result.output
}

/**
 * Liveness through the live-agent inventory: agent names clear when agents
 * exit, so a pane absent from the list is provably dead. A plain shell pane
 * (placeholder before attach) is not agent-scoped - callers treat that as
 * "unknown" via herdrListAgents.
 */
export async function herdrListAgents(
  deps: HerdrOpsDeps = defaultHerdrOpsDeps,
): Promise<Array<{ paneId: string; name?: string; status?: string }>> {
  const result = await deps.runHerdrCommand(["agent", "list"])
  const listed = parseEnvelopeResult<{ agents?: Array<{ pane_id?: string; name?: string; agent_status?: string }> }>(result)
  return (listed?.agents ?? [])
    .filter((agent) => typeof agent.pane_id === "string")
    .map((agent) => ({ paneId: agent.pane_id as string, name: agent.name, status: agent.agent_status }))
}

export async function herdrClosePane(
  paneId: string,
  deps: HerdrOpsDeps = defaultHerdrOpsDeps,
): Promise<void> {
  const result = await deps.runHerdrCommand(["pane", "close", paneId])
  if (!result.success) throw new Error(result.error ?? "herdr pane close failed")
}

/**
 * Close a pane, treating an already-dead pane as success. herdr answers a
 * missing pane with the `pane_not_found` error code (verified against
 * v0.9.5), which surfaces here as `result.code` from the JSON envelope.
 * Throws on any other failure so callers can retry real errors.
 */
export async function herdrClosePaneIfExists(
  paneId: string,
  deps: HerdrOpsDeps = defaultHerdrOpsDeps,
): Promise<"closed" | "gone"> {
  const result = await deps.runHerdrCommand(["pane", "close", paneId])
  if (result.success) return "closed"
  if (result.code === "pane_not_found" || /pane_not_found|not found/i.test(result.error ?? "")) {
    return "gone"
  }
  throw new Error(result.error ?? "herdr pane close failed")
}

export async function herdrCloseWorkspace(
  workspaceId: string,
  deps: HerdrOpsDeps = defaultHerdrOpsDeps,
): Promise<void> {
  const result = await deps.runHerdrCommand(["workspace", "close", workspaceId])
  if (!result.success) throw new Error(result.error ?? "herdr workspace close failed")
}

/** List workspaces whose label starts with the given prefix (sweep source of truth). */
export async function herdrListWorkspacesByLabelPrefix(
  prefix: string,
  deps: HerdrOpsDeps = defaultHerdrOpsDeps,
): Promise<Array<{ workspaceId: string; label: string }>> {
  const result = await deps.runHerdrCommand(["workspace", "list"])
  const listed = parseEnvelopeResult<{ workspaces?: Array<{ workspace_id?: string; label?: string }> }>(result)
  return (listed?.workspaces ?? [])
    .filter((workspace) => (workspace.label ?? "").startsWith(prefix))
    .map((workspace) => ({ workspaceId: workspace.workspace_id ?? "", label: workspace.label ?? "" }))
    .filter((workspace) => workspace.workspaceId.length > 0)
}

/** List team workspaces by label prefix (the sweep source of truth). */
export async function herdrListTeamWorkspaces(
  deps: HerdrOpsDeps = defaultHerdrOpsDeps,
): Promise<Array<{ workspaceId: string; label: string }>> {
  return herdrListWorkspacesByLabelPrefix(HERDR_TEAM_WORKSPACE_LABEL_PREFIX, deps)
}

/**
 * Pane-auth handoff for herdr tabs: a fresh single-use 0600 password file
 * whose path travels via `tab create --env OPENCODE_SERVER_PASSWORD_FILE=...`
 * - never the password itself, which would be world-readable in the process
 * list (`herdr tab create --env` argv). The attach line delivered with
 * `pane run` is wrapped by withPaneAuth, which sources and unlinks the file,
 * so authenticated attach works exactly like the tmux path
 * (buildPaneAuthEnvironmentArgs). One call = one file = one tab.
 */
export function buildHerdrPaneAuthEnv(): Record<string, string> {
  const handoff = createPaneAuthHandoff()
  if (!handoff) return {}
  const env: Record<string, string> = { OPENCODE_SERVER_PASSWORD_FILE: handoff.file }
  if (handoff.username !== undefined) env["OPENCODE_SERVER_USERNAME"] = handoff.username
  return env
}
