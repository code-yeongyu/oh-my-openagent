import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import * as z from "zod"

export const DAEMON_LAUNCH_SPEC_FILENAME = "daemon-launch-spec.json"

export const DAEMON_LAUNCH_SPEC_ERROR_CODES = [
  "launch_spec_insecure",
  "launch_spec_path_escape",
  "launch_spec_env_denied",
  "launch_spec_missing_extension",
  "launch_spec_invalid",
] as const

export type DaemonLaunchSpecErrorCode = (typeof DAEMON_LAUNCH_SPEC_ERROR_CODES)[number]

export class DaemonLaunchSpecError extends Error {
  readonly name = "DaemonLaunchSpecError"
  readonly code: DaemonLaunchSpecErrorCode

  constructor(code: DaemonLaunchSpecErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

const SPEC_ENV_KEY = /^(SENPI|OMO|PI)_[A-Z0-9_]+$/

const daemonLaunchSpecSchema = z.object({
  spec_version: z.literal(1),
  core: z.object({
    session_runtime: z.literal("in-process"),
    multi_session: z.literal(true),
    extensions: z.array(z.string().min(1)).min(1),
  }).strict(),
  tunables: z.object({
    idleExitMs: z.number().int().positive(),
    coldStart: z.enum(["transient", "persistent"]),
  }).strict(),
  env: z.record(z.string(), z.string()),
}).strict()

export type DaemonLaunchSpec = z.infer<typeof daemonLaunchSpecSchema>

export function resolveDaemonLaunchSpecPath(pluginRoot: string): string {
  return join(pluginRoot, DAEMON_LAUNCH_SPEC_FILENAME)
}

/**
 * Parse a daemon launch spec from disk.
 *
 * Trust rules match senpi's CLI: reject group/world-writable files and `..`
 * escapes in extension paths. omo.json must not override `core`; only
 * `tunables.idleExitMs` (via `task.host_idle_exit_ms`) and `coldStart`
 * (via `omo daemon run --persistent`) may be overlaid by later callers.
 */
export function readDaemonLaunchSpec(path: string): DaemonLaunchSpec {
  const stat = statSpecFile(path)
  rejectInsecureMode(path, stat.mode, stat.uid)

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new DaemonLaunchSpecError("launch_spec_invalid", `launch spec is not JSON: ${path}`)
    }
    throw error
  }

  const parsed = daemonLaunchSpecSchema.safeParse(raw)
  if (!parsed.success) {
    throw new DaemonLaunchSpecError("launch_spec_invalid", `launch spec failed schema: ${path}`)
  }

  const spec = parsed.data
  for (const key of Object.keys(spec.env)) {
    if (!SPEC_ENV_KEY.test(key)) {
      throw new DaemonLaunchSpecError("launch_spec_env_denied", `launch_spec_env_denied: ${key}`)
    }
  }

  const specDir = dirname(path)
  for (const extension of spec.core.extensions) {
    const resolved = resolveContainedExtension(specDir, extension)
    if (!existsSync(resolved)) {
      throw new DaemonLaunchSpecError(
        "launch_spec_missing_extension",
        `launch_spec_missing_extension: ${extension}`,
      )
    }
  }

  return spec
}

function statSpecFile(path: string): { readonly mode: number; readonly uid: number } {
  try {
    const stat = statSync(path)
    if (!stat.isFile()) {
      throw new DaemonLaunchSpecError("launch_spec_invalid", `launch spec is not a file: ${path}`)
    }
    return { mode: stat.mode, uid: stat.uid }
  } catch (error) {
    if (error instanceof DaemonLaunchSpecError) throw error
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new DaemonLaunchSpecError("launch_spec_invalid", `launch spec is missing: ${path}`)
    }
    throw error
  }
}

function rejectInsecureMode(path: string, mode: number, uid: number): void {
  if (process.platform === "win32") return
  if ((mode & 0o022) !== 0) {
    throw new DaemonLaunchSpecError("launch_spec_insecure", `launch_spec_insecure: ${path}`)
  }
  const currentUid = process.getuid?.()
  if (currentUid !== undefined && uid !== currentUid) {
    throw new DaemonLaunchSpecError("launch_spec_insecure", `launch_spec_insecure: ${path}`)
  }
}

function resolveContainedExtension(specDir: string, extension: string): string {
  const posix = extension.replaceAll("\\", "/")
  if (posix.includes("\0") || posix.split("/").includes("..") || isAbsolute(extension) || isAbsolute(posix)) {
    throw new DaemonLaunchSpecError("launch_spec_path_escape", `launch_spec_path_escape: ${extension}`)
  }
  const resolved = resolve(specDir, extension)
  const rel = relative(specDir, resolved)
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new DaemonLaunchSpecError("launch_spec_path_escape", `launch_spec_path_escape: ${extension}`)
  }
  return resolved
}
