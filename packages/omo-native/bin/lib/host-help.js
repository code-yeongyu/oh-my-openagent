// The daemon is a product command; the host verbs are implemented by the pinned engine.
const daemon = {
  run: "[--json] [--no-upgrade] [--pinned] [--persistent]  ensure a daemon is serving this agent dir",
  adopt: "<session-id|name> [--interrupt] [--force] [--json]  take a session into this terminal",
  status: "[--include-workers] [--json]  report who is serving and which sessions exist",
  stop: "[--drain] [--all] [--wait] [--timeout <seconds>] [--json]  end the daemon",
  handoff: "[--no-upgrade] [--json]  hand the socket to this build, keeping live sessions",
  gc: "[--prune-store-index] [--store <path>] [--json]  remove dead endpoint state",
  "rollback-prepare": "[--store <path>] [--allow-missing-index] [--dry-run] [--json]  migrate retained task records",
}
const host = {
  ensure: "[--socket <path>] [--launch-spec <file>] [--policy upgrade|fallback|never]",
  handoff:
    "[--socket <path>] [--launch-spec <file>] [--when idle --operation <id> --if-instance <id> --if-generation <n> --target-build <id>]",
  status: "[--socket <path>] [--all] [--include-workers]",
  stop: "[--socket <path>] [--drain] [--force]",
  "shard-path": "--kind <p|i> --owner <id> [--root <dir>]",
  gc: "[--agent-dir <dir>]",
  session: "<open|close|unload|model|prompt|steer|abort|read|state|list|wait> [options]",
}

export const daemonSubcommands = new Set(Object.keys(daemon))

function usage(family, table, verb) {
  if (Object.hasOwn(table, verb)) return `usage: omo ${family} ${verb} ${table[verb]}`
  return [
    `usage: omo ${family} <${Object.keys(table).join("|")}> [options]`,
    ...Object.entries(table).map(([name, options]) => `  ${name} ${options}`),
  ].join("\n")
}

export const daemonUsage = usage("daemon", daemon)

export function hostHelp(args) {
  const [family, ...rest] = args
  if (family !== "host" && family !== "daemon") return undefined
  // After --, tokens are operands, including literal prompt text.
  const end = rest.indexOf("--")
  const options = end < 0 ? rest : rest.slice(0, end)
  if (!options.includes("--help") && !options.includes("-h")) return undefined
  const table = family === "daemon" ? daemon : host
  return usage(
    family,
    table,
    options.find((arg) => Object.hasOwn(table, arg)),
  )
}
