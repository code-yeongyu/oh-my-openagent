import { MERGED_OMO_CONFIG_PATH, type OmoConfigDiagnostic } from "./types"

/**
 * A config path as a doctor shows it: home-relative (`~/.omo/omo.jsonc`) when it lives under `homeDir`.
 * The part after `~` always uses forward slashes, so a warning reads the same on every platform.
 * A path outside the home directory keeps its native form.
 */
export function displayOmoConfigPath(path: string, homeDir: string | undefined): string {
  if (path === MERGED_OMO_CONFIG_PATH) return "merged config"
  if (homeDir === undefined || homeDir.length === 0) return path
  // Compare with one separator: a Windows home can arrive in POSIX form (C:/Users/me) while the
  // file path is native (C:\Users\me\...), and drive-letter paths compare case-insensitively.
  const slashed = (value: string) => value.replaceAll("\\", "/")
  const home = slashed(homeDir).replace(/\/+$/, "")
  const file = slashed(path)
  const fold = (value: string) => (/^[A-Za-z]:\//.test(home) ? value.toLowerCase() : value)
  if (fold(file) === fold(home)) return "~"
  return fold(file).startsWith(`${fold(home)}/`) ? `~${file.slice(home.length)}` : path
}

function notLoadedReason(diagnostic: OmoConfigDiagnostic): string {
  switch (diagnostic.kind) {
    case "parse":
      return "JSONC parse error"
    case "read":
      return "unreadable"
    default:
      return diagnostic.issuePaths === undefined || diagnostic.issuePaths.length === 0
        ? "invalid config"
        : `invalid: ${diagnostic.issuePaths.join(", ")}`
  }
}

/**
 * Doctor lines, without a severity prefix, for every key the loader ignored and every file it did
 * not load: one line per dropped key, e.g. `config: ~/.omo/omo.jsonc: task.host_engine_policy ignored
 * (invalid value)`. Deprecated-key and profile notices are reported by their own surfaces.
 */
export function omoConfigDiagnosticLines(
  diagnostics: readonly OmoConfigDiagnostic[],
  options: { readonly homeDir?: string } = {},
): readonly string[] {
  return diagnostics.flatMap((diagnostic) => {
    const file = displayOmoConfigPath(diagnostic.path, options.homeDir)
    switch (diagnostic.kind) {
      case "invalid-value":
        return (diagnostic.issuePaths ?? []).map((key) => `config: ${file}: ${key} ignored (invalid value)`)
      case "unknown-keys":
        return (diagnostic.issuePaths ?? []).map((key) => `config: ${file}: ${key} ignored (unknown key)`)
      case "parse":
      case "read":
      case "validation":
        return diagnostic.path === MERGED_OMO_CONFIG_PATH
          ? [`config: ${file}: reset to defaults (${notLoadedReason(diagnostic)})`]
          : [`config: ${file}: not loaded (${notLoadedReason(diagnostic)})`]
      case "deprecated-keys":
      case "profile":
        return []
    }
  })
}
