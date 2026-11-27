// The daemon is a product command; the host verbs are implemented by the pinned engine.
const daemon = {
  run: [
    "[--json] [--no-upgrade] [--pinned] [--persistent]",
    "ensure a daemon is serving this agent dir (start, reuse, or hand off)",
  ],
  adopt: [
    "<session-id|name> [--interrupt] [--force] [--json]",
    "take a session a host holds into this terminal (--interrupt, --force)",
  ],
  status: ["[--include-workers] [--json]", "report who is serving and which sessions exist"],
  stop: [
    "[--drain] [--all] [--wait] [--timeout <seconds>] [--json]",
    "end the daemon; --drain lets in-flight work finish first",
  ],
  handoff: ["[--no-upgrade] [--json]", "hand the socket to this build, keeping live sessions"],
  gc: [
    "[--prune-store-index] [--store <path>] [--json]",
    "remove dead endpoint state; --prune-store-index drops missing store paths",
  ],
  "rollback-prepare": [
    "[--store <path>] [--allow-missing-index] [--dry-run] [--json]",
    "migrate retained task records back to rpc.sock before downgrading",
  ],
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

export const daemonUsage = [
  `usage: omo daemon <${Object.keys(daemon).join("|")}> [options]`,
  "",
  ...Object.entries(daemon).map(([name, [, description]]) => `  ${name.padEnd(9)} ${description}`),
  "",
  "  --json            print the engine's JSON line instead of a summary",
  "  --no-upgrade      never hand off, even from an older build",
  "  --pinned          with run, the host it starts never idle-exits (the always-on session host unit)",
  "  --include-workers include subagent sessions in status",
  "  --all             apply stop to every discovered endpoint",
  "  --wait            with stop --drain --all, wait for generations and claims to end",
].join("\n")

export function hostHelp(args) {
  const [family, ...rest] = args
  if (family !== "host" && family !== "daemon") return undefined
  // After --, tokens are operands, including literal prompt text.
  const end = rest.indexOf("--")
  const options = end < 0 ? rest : rest.slice(0, end)
  if (!options.includes("--help") && !options.includes("-h")) return undefined
  const table = family === "daemon" ? daemon : host
  const verb = options.find((arg) => Object.hasOwn(table, arg))
  if (family === "daemon")
    return verb === undefined ? daemonUsage : `usage: omo daemon ${verb} ${daemon[verb].join("  ")}`
  return usage(family, host, verb)
}
