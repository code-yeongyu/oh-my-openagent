import { delimiter } from "node:path"

const WINDOWS_KEYS = ["SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "PATHEXT", "COMSPEC", "TEMP", "TMP"] as const

// A Windows child cannot start from an environment that has only PATH. Other platforms need nothing.
export const windowsProcessEnv = (): NodeJS.ProcessEnv => {
  if (process.platform !== "win32") return {}
  const env: NodeJS.ProcessEnv = {}
  for (const key of WINDOWS_KEYS) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

// Git bash scripts call sha256sum, mktemp, env and cut. Those live in Git's usr/bin, which the
// Actions bash shell prepends and a raw PATH does not.
export const bashPath = (): string => {
  const path = process.env.PATH ?? ""
  if (process.platform !== "win32") return path
  const gitBin = path.split(delimiter).find((entry) => /[\\/]Git[\\/](?:bin|cmd)$/i.test(entry))
  if (gitBin === undefined) return path
  return `${gitBin.replace(/[\\/](?:bin|cmd)$/i, "\\usr\\bin")}${delimiter}${path}`
}

// Git bash does not open a backslash path mixed with a forward slash.
export const forBash = (value: string): string => (process.platform === "win32" ? value.replaceAll("\\", "/") : value)
