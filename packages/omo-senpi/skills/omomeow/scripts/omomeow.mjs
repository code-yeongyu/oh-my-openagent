#!/usr/bin/env node
// omomeow skill CLI: the deterministic half of OmOMeow mode (reconcile state, session map, nudge, and
// the nudge timer service). Node or Bun, `node:*` built-ins only. Every command prints JSON.
import { parseArgs } from "node:util"

import { createContext, UsageError } from "./lib/cli-context.mjs"
import { nudgeCommand, snapshotCommand } from "./lib/nudge-command.mjs"
import { serviceCommand } from "./lib/service-command.mjs"
import { forgetCommand, ownerCommand, reconcileCommand, recordCommand, sessionCommand, statusCommand } from "./lib/state-commands.mjs"

const USAGE = `usage: omomeow.mjs <command>
  reconcile [--manifest <path>]           what to install, update, or remove for this user
  record <feature> [--data <json>]        mark a feature installed (manifest version + current config)
  forget <feature>                        mark a feature removed
  status                                  state, config, and nudge service summary
  owner set --platform <p> --target <id> [--bot <id>] | owner show
  session set <tab> [--title t] [--thread t] [--session-id id] [--started-at iso]
                    [--platform p --target id [--bot id]]  (requester; defaults to the owner)
  session progress <tab> <text> | session close <tab> | session list
  snapshot                                herdr tabs and the items a nudge would report (no writes)
  nudge [--dry-run] [--scheduled]         send the overview DM when something runs and changed
                                          (--scheduled: run by the timer; logs to logs/nudge.jsonl)
  service status|render|install|uninstall the timer that runs \`nudge --scheduled\` every interval_minutes
                                          (launchd on macOS, systemd user timer on Linux)`

const COMMANDS = {
  reconcile: reconcileCommand,
  record: recordCommand,
  forget: forgetCommand,
  status: statusCommand,
  owner: ownerCommand,
  session: sessionCommand,
  snapshot: snapshotCommand,
  nudge: nudgeCommand,
  service: serviceCommand,
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      manifest: { type: "string" },
      data: { type: "string" },
      platform: { type: "string" },
      target: { type: "string" },
      bot: { type: "string" },
      title: { type: "string" },
      thread: { type: "string" },
      "session-id": { type: "string" },
      "started-at": { type: "string" },
      "dry-run": { type: "boolean" },
      scheduled: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  })
  const [command, ...rest] = positionals
  if (values.help || command === undefined) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  const handler = COMMANDS[command]
  if (handler === undefined) throw new UsageError(`unknown command ${command}\n${USAGE}`)
  return handler(createContext(process.env), values, rest)
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write(`omomeow: ${error.message}\n`)
  process.exitCode = error instanceof UsageError ? 2 : 1
}
