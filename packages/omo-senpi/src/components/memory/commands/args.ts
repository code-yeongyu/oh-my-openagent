// Minimal slash-command argument parser shared by the memory command handlers.
// Supports `--flag value`, `--flag=value`, and declared boolean flags.

export interface ParsedCommandArgs {
  readonly positionals: string[]
  readonly flags: ReadonlyMap<string, string | true>
}

export interface ParseCommandArgsOptions {
  /** Flag names that never consume the following token. */
  readonly booleans?: readonly string[]
}

export function parseCommandArgs(args: string, options: ParseCommandArgsOptions = {}): ParsedCommandArgs {
  const booleans = new Set(options.booleans ?? [])
  const positionals: string[] = []
  const flags = new Map<string, string | true>()

  const tokens = args.trim().split(/\s+/).filter(Boolean)
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? ""
    if (!token.startsWith("--")) {
      positionals.push(token)
      continue
    }
    const body = token.slice(2)
    const equals = body.indexOf("=")
    if (equals >= 0) {
      flags.set(body.slice(0, equals), body.slice(equals + 1))
      continue
    }
    const next = tokens[index + 1]
    if (!booleans.has(body) && next !== undefined && !next.startsWith("--")) {
      flags.set(body, next)
      index += 1
      continue
    }
    flags.set(body, true)
  }

  return { positionals, flags }
}
