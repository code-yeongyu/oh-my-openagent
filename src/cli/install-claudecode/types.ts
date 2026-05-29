export interface CommandRunOptions {
  readonly env?: { readonly [key: string]: string | undefined }
}

export type RunCommand = (
  command: string,
  args: readonly string[],
  options: CommandRunOptions,
) => Promise<void>

export interface ClaudeCodeInstallOptions {
  readonly marketplaceRepo?: string
  readonly pluginRef?: string
  readonly runCommand?: RunCommand
  readonly log?: (message: string) => void
  readonly homeDir?: string
  readonly env?: { readonly [key: string]: string | undefined }
}

export interface ClaudeCodeInstallResult {
  readonly marketplaceName: string
  readonly pluginRef: string
}
