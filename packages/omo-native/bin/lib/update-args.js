const selfUpdateTargets = new Set(["self", "senpi", "omo"])
// Updating extensions or model catalogs is the engine's job; everything else under `update`
// would try to replace the pinned engine, so the launcher answers it instead.
const engineUpdateTargets = new Set(["--extensions", "--models"])
const PRINT_ONLY_FLAGS = new Set(["--dry-run", "--print"])
const HELP_FLAGS = new Set(["--help", "-h"])
// `--self` is the documented spelling of the bare command (docs/reference/omo-ai-publishing.md).
const KNOWN_FLAGS = new Set([...PRINT_ONLY_FLAGS, ...HELP_FLAGS, "--self"])

export const UPDATE_USAGE = `Usage: omo update [--dry-run | --print]

Update omo to the newest release on its channel. The engine is pinned by omo and moves with it.

Options:
  --dry-run, --print  print the update command without running it
  -h, --help          show this help`

/**
 * Whether `args` is a product self-update, which the launcher answers itself rather than letting
 * the engine move its pin: bare `update`, the self/senpi/omo targets, or flags only.
 * @param {readonly string[]} args
 */
export function isSelfUpdate(args) {
  if (args[0] !== "update") return false
  const rest = args.slice(1)
  if (rest.length === 0) return true
  if (rest.some((arg) => engineUpdateTargets.has(arg))) return false
  return rest.every((arg) => arg.startsWith("-") || selfUpdateTargets.has(arg))
}

/** @param {readonly string[]} args */
export function isPrintOnlyUpdate(args) {
  return args.slice(1).some((arg) => PRINT_ONLY_FLAGS.has(arg))
}

/**
 * Help and usage errors of a self-update, answered before any registry lookup or install:
 * `--help`/`-h` print the usage (exit 0), and a flag `update` does not know is a usage error that
 * names it (exit 2). Undefined means the arguments are a real update request (#9207).
 * @param {readonly string[]} args
 * @returns {{ exitCode: 0 | 2, stream: "stdout" | "stderr", text: string } | undefined}
 */
export function updateUsageAnswer(args) {
  const rest = args.slice(1)
  if (rest.some((arg) => HELP_FLAGS.has(arg))) return { exitCode: 0, stream: "stdout", text: UPDATE_USAGE }
  const unknown = rest.find((arg) => arg.startsWith("-") && !KNOWN_FLAGS.has(arg))
  if (unknown === undefined) return undefined
  return { exitCode: 2, stream: "stderr", text: `omo update: unknown option ${unknown}\nRun omo update --help for usage.` }
}
