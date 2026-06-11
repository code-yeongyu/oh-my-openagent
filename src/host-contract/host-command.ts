import type { HostSessionContext } from "./host-session"

export type HostCommandName = string

export type HostCommandCompletion = {
  value: string
  label?: string
  description?: string
}

export type HostCommandContext = HostSessionContext & {
  waitForIdle(): Promise<void>
  reload(): Promise<void>
}

export type HostCommandHandler = (input: {
  argument: string
  context: HostCommandContext
}) => Promise<void> | void

export type HostCommandDefinition = {
  name: HostCommandName
  description?: string
  getArgumentCompletions?: (argument: string, context: HostCommandContext) => Promise<readonly HostCommandCompletion[]>
  handler: HostCommandHandler
}

export type HostCommandRegistry = {
  registerCommand(command: HostCommandDefinition): void
  getCommands(): readonly HostCommandDefinition[]
}
