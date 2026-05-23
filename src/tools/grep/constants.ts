export const DEFAULT_MAX_DEPTH = 20
export const DEFAULT_MAX_FILESIZE = "10M"
export const DEFAULT_MAX_COUNT = 500
export const DEFAULT_MAX_COLUMNS = 1000
export const DEFAULT_CONTEXT = 2
export const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024

export const RG_SAFETY_FLAGS = [
  "--no-follow",
  "--color=never",
  "--no-heading",
  "--line-number",
  "--with-filename",
  // Suppress stderr warnings on broken/dangling symlinks and similar
  // non-fatal I/O issues so they don't tip the tool into the error branch.
  // See #3726.
  "--no-messages",
] as const

export const GREP_SAFETY_FLAGS = ["-n", "-H", "--color=never"] as const
