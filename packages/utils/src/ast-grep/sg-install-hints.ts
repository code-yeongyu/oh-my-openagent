import { SG_PATH_ENV_KEY } from "./types"

const OMO_PROVISION_HINT = "Start an OMO session so the bundled ast-grep skill provisions the pinned runtime automatically"
const ENV_OVERRIDE_HINT = `Or point ${SG_PATH_ENV_KEY} at an existing ast-grep binary`

const DARWIN_HINTS = [
  "brew install ast-grep",
  "npm install -g @ast-grep/cli",
  "cargo install ast-grep --locked",
] as const

const LINUX_HINTS = [
  "npm install -g @ast-grep/cli",
  "cargo install ast-grep --locked",
  "brew install ast-grep  # linuxbrew",
] as const

const WIN32_HINTS = [
  "scoop install main/ast-grep",
  "winget install ast-grep",
  "choco install ast-grep",
  "npm install -g @ast-grep/cli",
] as const

function platformHints(platform: NodeJS.Platform): readonly string[] {
  if (platform === "darwin") return DARWIN_HINTS
  if (platform === "win32") return WIN32_HINTS
  return LINUX_HINTS
}

export function sgInstallHints(platform: NodeJS.Platform = process.platform): readonly string[] {
  return [...platformHints(platform), OMO_PROVISION_HINT, ENV_OVERRIDE_HINT]
}

export function sgBinaryNotFoundMessage(platform: NodeJS.Platform = process.platform): string {
  return `ast-grep binary not found for ${platform}: no candidate passed the --version probe across the env override, OMO runtime, skill bin cache, PATH, or Homebrew prefixes.`
}
