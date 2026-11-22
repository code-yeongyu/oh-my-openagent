export const KNOWN_TERMINAL_PROGRAMS = [
  "Apple_Terminal",
  "iTerm.app",
  "vscode",
  "cursor",
  "windsurf",
  "zed",
  "WezTerm",
  "ghostty",
  "tmux",
  "Hyper",
  "WarpTerminal",
  "kitty",
  "alacritty",
  "Tabby",
  "rio",
  "mintty",
] as const

type KnownTerminalProgram = (typeof KNOWN_TERMINAL_PROGRAMS)[number]

export type TelemetryTerminalProgram = KnownTerminalProgram | "other"

function isKnownTerminalProgram(value: string): value is KnownTerminalProgram {
  return KNOWN_TERMINAL_PROGRAMS.some((known) => known === value)
}

export function toTelemetryTerminalProgram(termProgram: string | undefined): TelemetryTerminalProgram | undefined {
  if (termProgram === undefined || termProgram === "") return undefined
  return isKnownTerminalProgram(termProgram) ? termProgram : "other"
}
