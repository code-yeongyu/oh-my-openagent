import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { loadBuiltinCommands } from "../features/builtin-commands"
import { parseFrontmatter } from "../shared/frontmatter"

export type TargetCommandContext = {
  cwd: string
  isIdle?(): boolean
  waitForIdle?(): Promise<void>
  ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void
  }
}

export type TargetCommandOptions = {
  description?: string
  handler(argument: string, context: TargetCommandContext): Promise<void> | void
}

export type TargetCommandApi = {
  registerCommand(name: string, options: TargetCommandOptions): void
  sendUserMessage(content: string): void | Promise<void>
}

export type TargetCommandRegistrationOptions = {
  cwd: string
  teamModeEnabled?: boolean
}

type TargetCommandDefinition = {
  name: string
  description?: string
  template: string
}

function substitute(template: string, argument: string): string {
  return template
    .replaceAll("$ARGUMENTS", argument)
    .replaceAll("$SESSION_ID", "target-session")
    .replaceAll("$TIMESTAMP", new Date().toISOString())
}

async function waitForDispatchedCommandTurn(context: TargetCommandContext): Promise<void> {
  if (!context.isIdle || !context.waitForIdle) return

  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
    if (context.isIdle()) continue
    while (!context.isIdle()) {
      await context.waitForIdle()
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    return
  }
}

function discoverFileCommands(cwd: string): TargetCommandDefinition[] {
  const definitions = new Map<string, TargetCommandDefinition>()
  for (const directory of [join(cwd, ".agents", "command"), join(cwd, ".opencode", "command")]) {
    if (!existsSync(directory)) continue
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue
      const name = basename(entry.name, ".md")
      if (definitions.has(name)) continue
      const parsed = parseFrontmatter<Record<string, unknown>>(readFileSync(join(directory, entry.name), "utf8"))
      definitions.set(name, {
        name,
        description: typeof parsed.data.description === "string" ? parsed.data.description : undefined,
        template: parsed.body,
      })
    }
  }
  return [...definitions.values()]
}

export function registerTargetCommands(
  api: TargetCommandApi,
  options: TargetCommandRegistrationOptions,
): readonly string[] {
  const commands = new Map<string, TargetCommandDefinition>()
  for (const command of Object.values(loadBuiltinCommands(undefined, { teamModeEnabled: options.teamModeEnabled }))) {
    commands.set(command.name, command)
  }
  for (const command of discoverFileCommands(options.cwd)) {
    if (!commands.has(command.name)) commands.set(command.name, command)
  }

  for (const command of commands.values()) {
    api.registerCommand(command.name, {
      description: command.description,
      handler: async (argument, context) => {
        await api.sendUserMessage(substitute(command.template, argument))
        await waitForDispatchedCommandTurn(context)
      },
    })
  }
  return [...commands.keys()]
}
