// Senpi loads every extension even for launches that only print metadata: `--help` loads them to
// list their flags (cli/help-extension-flags.js), and `--list-models` / `--list-tips` build the
// runtime and exit before any session. The OpenCode config migration belongs to the first real
// session (docs/guide/migrating-from-opencode.md), so these launches must leave the user's files
// alone. The options are the ones senpi's own argv parser (cli/args.js) answers this way; the
// engine stops reading options at `--`, so everything after it is message text.
const METADATA_OPTIONS = new Set(["--help", "-h", "--list-models", "--list-tips"])

export function isMetadataOnlyLaunch(argv: readonly string[]): boolean {
  for (const arg of argv) {
    if (arg === "--") return false
    if (METADATA_OPTIONS.has(arg)) return true
  }
  return false
}
