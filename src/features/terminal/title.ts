export type SessionStatus = "ready" | "processing" | "tool" | "error" | "idle"

const STATUS_ICONS: Record<SessionStatus, string> = {
  ready: "",
  processing: "◐",
  tool: "⚡",
  error: "✖",
  idle: "○",
}

export interface TitleContext {
  sessionId: string
  sessionTitle?: string
  directory?: string
  status?: SessionStatus
  currentTool?: string
  customSuffix?: string
}

const DEFAULT_TITLE = "OpenCode"
const MAX_TITLE_LENGTH = 30

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 1) + "…"
}

export function formatTerminalTitle(ctx: TitleContext): string {
   const title = ctx.sessionTitle || DEFAULT_TITLE
   const truncatedTitle = truncate(title, MAX_TITLE_LENGTH)

   const parts: string[] = ["[OpenCode]", truncatedTitle]

   if (ctx.status) {
     parts.push(STATUS_ICONS[ctx.status])
   }

   return parts.join(" ")
}

function isTmuxEnvironment(): boolean {
  return !!process.env.TMUX || process.env.TERM_PROGRAM === "tmux"
}

export function setTerminalTitle(title: string): void {
  // Use stderr to avoid race conditions with stdout buffer
  // ANSI escape sequences work on stderr as well
  process.stderr.write(`\x1b]0;${title}\x07`)

  if (isTmuxEnvironment()) {
    process.stderr.write(`\x1bk${title}\x1b\\`)
  }
}

export function updateTerminalTitle(ctx: TitleContext): void {
  const title = formatTerminalTitle(ctx)
  setTerminalTitle(title)
}

export function resetTerminalTitle(): void {
  setTerminalTitle(`[OpenCode] ${DEFAULT_TITLE}`)
}
