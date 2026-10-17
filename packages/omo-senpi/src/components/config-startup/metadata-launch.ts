// Senpi loads every extension even for launches that only print metadata: `--help` loads them to
// list their flags (cli/help-extension-flags.js), and `--list-models` / `--list-tips` build the
// runtime and exit before any session. The OpenCode config migration belongs to the first real
// session (docs/guide/migrating-from-opencode.md), so these launches must leave the user's files
// alone. The walk below mirrors senpi's own argv parser (cli/args.js): an option's value is never
// read as an option, a multi-session host serves sessions whatever else it was given, and
// everything after `--` is message text.
const METADATA_OPTIONS = new Set(["--help", "-h", "--list-models", "--list-tips"])
const SESSION_HOST_OPTIONS = new Set(["--multi-session", "--listen"])

const ALWAYS_TAKES_VALUE = new Set([
  "--provider", "--model", "--api-key", "--system-prompt", "--append-system-prompt", "--name", "-n",
  "--session", "--session-id", "--fork", "--rebind", "--session-dir", "--models", "--tools", "-t",
  "--exclude-tools", "-xt", "--thinking", "--export", "--extension", "-e", "--skill", "--prompt-template",
  "--theme",
])
const TAKES_NON_OPTION_VALUE = new Set(["--mode", "--use-theme", "--tui-mode", "--list-models"])
const TAKES_NON_LONG_OPTION_VALUE = new Set(["--session-runtime", "--listen"])

function valueLength(arg: string, next: string | undefined): number {
  if (next === undefined) return 0
  if (ALWAYS_TAKES_VALUE.has(arg)) return 1
  if (TAKES_NON_OPTION_VALUE.has(arg)) return next.startsWith("-") || next.startsWith("@") ? 0 : 1
  if (TAKES_NON_LONG_OPTION_VALUE.has(arg)) return next.startsWith("--") ? 0 : 1
  if (arg === "--print" || arg === "-p") {
    return next.startsWith("@") || (next.startsWith("-") && !next.startsWith("---")) ? 0 : 1
  }
  if (arg.startsWith("--") && !arg.includes("=")) return next.startsWith("-") || next.startsWith("@") ? 0 : 1
  return 0
}

export function isMetadataOnlyLaunch(argv: readonly string[]): boolean {
  let metadata = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined || arg === "--") break
    if (SESSION_HOST_OPTIONS.has(arg)) return false
    if (METADATA_OPTIONS.has(arg)) metadata = true
    index += valueLength(arg, argv[index + 1])
  }
  return metadata
}
