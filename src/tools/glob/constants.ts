export { resolveGrepCli, resolveGrepCliWithAutoInstall, type GrepBackend } from "../grep/constants"

export const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_LIMIT = 100
export const DEFAULT_MAX_DEPTH = 20
export const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024

export const RG_FILES_FLAGS = [
  "--files",
  "--color=never",
  "--glob=!.git/*",
] as const
