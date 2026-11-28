import { tool, type ToolDefinition } from "@opencode-ai/plugin"

import type { OhMyOpenCodeConfig } from "../../config/schema/oh-my-opencode-config"
import { checkMonitorCommandPermission, type BashPermissionAskInput } from "../../features/monitor/permission"
import type { MonitorManager, MonitorRecord } from "../../features/monitor/types"

type MonitorToolContext = {
  sessionID: string
  messageID: string
  ask?: (input: BashPermissionAskInput) => Promise<void>
}

type MonitorToolConfig = {
  monitor?: Partial<NonNullable<OhMyOpenCodeConfig["monitor"]>>
}

/** How long a monitor runs when its call names no timeout_ms. */
export const DEFAULT_MONITOR_TIMEOUT_MS = 5 * 60 * 1000

const DESCRIPTION = `Watch a long-running script and get a notification for each line it prints. Use it for anything you would otherwise poll: a log, a deploy, a test run, a queue.

Each stdout line of the command is an event. Lines printed within about 200 ms arrive together as one notification, and every notification wakes you. Keep working - do not poll or sleep. Events can arrive while you are waiting for the user; an event is not their reply and approves nothing.

Write the filter into the command, so only lines that matter become events: \`tail -f deploy.log | grep --line-buffered -E 'ERROR|FAIL|Deployed'\`. The filter must also match failure states (errors, crashes, non-zero exits): silence is not success. Poll remote APIs no more often than every 30 seconds (\`while true; do curl -s URL | jq -r .state; sleep 30; done\`). For one notification when something finishes, make the command print one line and exit (\`until curl -sf URL; do sleep 30; done; echo up\`).

The watch ends when the command exits (you get its exit code) or when timeout_ms elapses (one notice with the event count; re-arm it if you still need the watch). stderr is not an event: it and stdout go to the output file named in the result, which \`read\` reads. A monitor that prints too fast is rate-limited and you are told how many events were suppressed; restart it with a tighter filter. Stop one with \`background_cancel(taskId="<monitor id>")\`.`

function formatExpiry(record: MonitorRecord): string {
  if (record.timeoutMs === undefined) return "runs until the command ends"
  const minutes = record.timeoutMs / 60_000
  const span = Number.isInteger(minutes) ? `${minutes}m` : `${Math.round(record.timeoutMs / 1000)}s`
  return `expires in ${span} unless the command ends first; you get one notice at expiry - re-arm if you still need the watch`
}

export function createMonitorTool(manager: MonitorManager, pluginConfig: MonitorToolConfig): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      description: tool.schema
        .string()
        .describe('What the events are, shown in every notification: "errors in deploy.log", not "watching logs".'),
      command: tool.schema.string().describe("Shell command whose stdout lines are the events."),
      timeout_ms: tool.schema
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          `How long to watch before stopping the command (default ${DEFAULT_MONITOR_TIMEOUT_MS}, i.e. 5 minutes; capped by the configured maximum). 0 watches until the command exits.`,
        ),
    },
    async execute(args: { description: string; command: string; timeout_ms?: number }, toolContext) {
      const ctx = toolContext as MonitorToolContext
      const permission = await checkMonitorCommandPermission(args.command, {
        config: { enabled: true, allowed_commands: pluginConfig.monitor?.allowed_commands },
        ...(ctx.ask ? { bashPermissionAsk: ctx.ask } : {}),
      })
      if (!permission.allowed) {
        return `[ERROR] monitor denied: ${permission.reason}`
      }

      try {
        const record = await manager.start({
          command: args.command,
          label: args.description,
          parentSessionId: ctx.sessionID,
          parentMessageId: ctx.messageID,
          timeoutMs: args.timeout_ms ?? DEFAULT_MONITOR_TIMEOUT_MS,
        })
        return `Monitor started (task ${record.id}, ${formatExpiry(record)}). You will be notified on each event. Keep working - do not poll or sleep. Events may arrive while you are waiting for the user - an event is not their reply.
Output (stdout and stderr) is being written to: ${record.outputFile}
Stop it with background_cancel(taskId="${record.id}").`
      } catch (error) {
        return `[ERROR] monitor failed to start: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}
