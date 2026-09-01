import { log } from "../../shared/logger"
import type { V2PluginContext } from "./types"

/**
 * Command bridge: convert the V1 `config.command` map (produced by
 * applyCommandConfig) into V2 CommandDefinitions.
 *
 * V1 command shape: `{ template, description?, agent?, subtask?, model? }`.
 * V2 execution: render the template (the V1 runtime substitutes
 * `{argument:...}` and `$ARGUMENTS`-style placeholders; we perform the same
 * substitution, then submit it through the V2 session prompt so the prompt
 * hook chain still runs).
 */

type V1CommandConfig = Record<string, unknown>

const ARGUMENT_PATTERNS: Array<(argumentsText: string) => (input: string) => string> = [
  // {argument:defaultValue} / {argument}
  () => (input) => input,
]

export function renderCommandTemplate(template: string, commandArgs: string): string {
  return template
    .replaceAll("{argument}", commandArgs)
    .replaceAll("$ARGUMENTS", commandArgs)
    .replaceAll("$1", commandArgs)
}

export function toV2CommandDefinition(args: {
  readonly name: string
  readonly command: V1CommandConfig
  readonly ctx: V2PluginContext
}): {
  readonly name: string
  readonly description?: string
  readonly execute: (input: { sessionID: string; prompt: { text: string }; delivery: "steer" | "queue" }) => Promise<void>
} | null {
  const template = args.command["template"]
  if (typeof template !== "string") return null
  const agent = typeof args.command["agent"] === "string" ? (args.command["agent"] as string) : undefined
  const description =
    typeof args.command["description"] === "string" ? (args.command["description"] as string) : undefined
  return {
    name: args.name,
    ...(description ? { description } : {}),
    execute: async (input) => {
      const text = renderCommandTemplate(template, input.prompt?.text ?? "")
      log("[v2-command-bridge] command invoked", { name: args.name, sessionID: input.sessionID })
      const promptInput: Record<string, unknown> = {
        sessionID: input.sessionID,
        text,
        delivery: input.delivery,
      }
      if (agent) promptInput["agent"] = agent
      await args.ctx.session.prompt(promptInput as Parameters<typeof args.ctx.session.prompt>[0])
    },
  }
}

export async function registerV2Commands(args: {
  readonly ctx: V2PluginContext
  readonly v1Commands: Record<string, V1CommandConfig>
}): Promise<void> {
  const entries = Object.entries(args.v1Commands)
  if (entries.length === 0) return
  log("[v2-command-bridge] registering commands", { count: entries.length })
  await args.ctx.command.transform((draft) => {
    for (const [name, command] of entries) {
      const definition = toV2CommandDefinition({ name, command, ctx: args.ctx })
      if (definition) draft.add(definition)
    }
  })
}
