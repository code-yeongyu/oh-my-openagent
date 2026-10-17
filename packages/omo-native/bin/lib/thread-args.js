/**
 * The `omo thread` command-line contract: its exit codes and the one argv parser every subcommand
 * uses. Exit codes follow `omo daemon` (`daemon-args.js`): 2 usage, 3 nothing answering, 4 not
 * possible here; a refusal the gateway answered as data is 1 (its `error.code` is in the JSON).
 */

export const THREAD_EXIT = {
  ok: 0,
  refused: 1,
  usage: 2,
  unavailable: 3,
  unsupported: 4,
  failed: 5,
}

/**
 * Splits argv into positionals, boolean flags and value flags. An unknown `--flag`, a value flag
 * without its value, or a repeated value flag is a usage error; `--` ends flag parsing, so a text
 * that starts with `-` can still be sent.
 */
export function parseArgs(args, { booleans = [], values = [] } = {}) {
  const flags = new Set()
  const options = {}
  const positionals = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--") {
      positionals.push(...args.slice(index + 1))
      break
    }
    if (!argument.startsWith("--")) {
      positionals.push(argument)
      continue
    }
    if (booleans.includes(argument)) {
      flags.add(argument)
      continue
    }
    if (!values.includes(argument)) return { error: `unknown option '${argument}'` }
    const value = args[index + 1]
    if (value === undefined) return { error: `${argument} needs a value` }
    if (Object.hasOwn(options, argument)) return { error: `${argument} was given twice` }
    options[argument] = value
    index += 1
  }
  return { flags, options, positionals }
}

/** A non-negative integer flag value, or undefined when the flag is absent; NaN marks a bad value. */
export function integerOption(options, name) {
  const raw = options[name]
  if (raw === undefined) return undefined
  return /^\d+$/.test(raw) ? Number(raw) : Number.NaN
}
