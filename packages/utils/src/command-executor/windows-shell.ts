import { existsSync } from "node:fs"

export interface ResolveWindowsCmdPathOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly fileExists?: (path: string) => boolean
  readonly platform?: NodeJS.Platform
}

/**
 * Resolves an absolute cmd.exe path for child spawns on Windows.
 *
 * Spawning a bare-name "cmd.exe" relies on the CreateProcess search order
 * (application dir, current dir, System32, PATH). Under sanitized plugin
 * environments or security software that search can fail with EPERM
 * (uv_spawn 'cmd.exe', #7162). Callers should spawn the returned absolute
 * path instead and keep their previous behavior when null is returned.
 */
export function resolveWindowsCmdPath(options: ResolveWindowsCmdPathOptions = {}): string | null {
  const platform = options.platform ?? process.platform
  if (platform !== "win32") return null

  const env = options.env ?? process.env
  const fileExists = options.fileExists ?? existsSync

  const comspec = env.COMSPEC
  if (typeof comspec === "string" && comspec.length > 0 && fileExists(comspec)) {
    return comspec
  }

  const systemRoot = env.SystemRoot ?? env.windir
  if (typeof systemRoot === "string" && systemRoot.length > 0) {
    const candidate = `${systemRoot}\\System32\\cmd.exe`
    if (fileExists(candidate)) return candidate
  }

  const defaultCandidate = "C:\\Windows\\System32\\cmd.exe"
  if (fileExists(defaultCandidate)) return defaultCandidate

  return null
}
