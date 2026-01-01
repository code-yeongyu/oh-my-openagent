export interface AutoSlashCommandHookInput {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
  messageID?: string
}

export interface AutoSlashCommandHookOutput {
  message: Record<string, unknown>
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
}

export interface ParsedSlashCommand {
  command: string
  args: string
  raw: string
}

export interface AutoSlashCommandResult {
  detected: boolean
  parsedCommand?: ParsedSlashCommand
  injectedMessage?: string
}
