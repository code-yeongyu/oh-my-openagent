export type TerminalBackend = "tmux" | "zellij" | "windows-terminal" | "kitty" | "iterm2"

export interface TerminalSession {
  backend: TerminalBackend
  sessionId: string
  paneId: string
  createdAt: number
  lastUsed: number
}

export interface TerminalMultiplexer {
  name: TerminalBackend
  supported: boolean
  createSession(name: string): Promise<TerminalSession>
  sendKeys(session: TerminalSession, keys: string): Promise<void>
  readOutput(session: TerminalSession): Promise<string>
  killSession(session: TerminalSession): Promise<void>
  listSessions(): Promise<TerminalSession[]>
}
