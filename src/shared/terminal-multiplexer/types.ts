export type MultiplexerType = "tmux" | "zellij"

export interface PaneHandle {
  label: string
  nativeId?: string
}

export interface MultiplexerCapabilities {
  manualLayout: boolean
  persistentLabels: boolean
}

export interface SpawnOptions {
  label: string
  splitFrom?: PaneHandle
  direction?: "horizontal" | "vertical"
}

export interface Multiplexer {
  type: MultiplexerType
  capabilities: MultiplexerCapabilities

  ensureSession(name: string): Promise<void>
  killSession(name: string): Promise<void>

  spawnPane(cmd: string, options: SpawnOptions): Promise<PaneHandle>
  closePane(handle: PaneHandle): Promise<void>

  getPanes(): Promise<PaneHandle[]>
}
