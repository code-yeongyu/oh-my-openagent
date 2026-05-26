export class TuiRenderer {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private currentContent: string = ""
  private running: boolean = false
  private cleanupFns: Array<() => void> = []

  constructor(private refreshIntervalMs: number = 1000) {}

  start(): void {
    if (this.running) return
    this.running = true
    // Set raw stdin mode
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    // Hide cursor
    process.stdout.write("\x1b[?25l")
    // Clear screen
    this.clear()
    // Set up refresh interval
    this.intervalId = setInterval(() => {
      this.render()
    }, this.refreshIntervalMs)
    // Handle SIGINT/SIGTERM
    const onSignal = () => this.stop()
    process.on("SIGINT", onSignal)
    process.on("SIGTERM", onSignal)
    this.cleanupFns.push(() => {
      process.off("SIGINT", onSignal)
      process.off("SIGTERM", onSignal)
    })
    // Handle stdin keypresses
    const onData = (data: Buffer) => {
      // q = quit, r = refresh, f = follow
      const key = data.toString()
      if (key === "q") this.stop()
      else if (key === "r") this.render()
    }
    process.stdin.on("data", onData)
    this.cleanupFns.push(() => {
      process.stdin.off("data", onData)
    })
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    // Show cursor
    process.stdout.write("\x1b[?25h")
    // Reset stdin
    process.stdin.setRawMode?.(false)
    process.stdin.pause()
    // Run cleanup
    for (const fn of this.cleanupFns) fn()
    this.cleanupFns = []
  }

  isRunning(): boolean {
    return this.running
  }

  setContent(content: string): void {
    this.currentContent = content
  }

  private clear(): void {
    process.stdout.write("\x1b[2J\x1b[H") // Clear screen, move cursor to home
  }

  render(): void {
    // Move cursor home, then write content
    process.stdout.write("\x1b[H" + this.currentContent)
  }

  getSize(): { rows: number; cols: number } {
    const rows = process.stdout.rows ?? 24
    const cols = process.stdout.columns ?? 80
    return { rows, cols }
  }
}

// SGR color codes for 256-color terminals
export function color256(code: number, text: string): string {
  return `\x1b[38;5;${code}m${text}\x1b[0m`
}

export function bgColor256(code: number, text: string): string {
  return `\x1b[48;5;${code}m${text}\x1b[0m`
}

export function bold(text: string): string {
  return `\x1b[1m${text}\x1b[22m`
}

export function dim(text: string): string {
  return `\x1b[2m${text}\x1b[22m`
}

// Status colors
export function colorForStatus(status: string): number {
  switch (status) {
    case "running":
      return 35 // green
    case "idle":
      return 220 // yellow
    case "error":
      return 124 // red
    case "completed":
      return 39 // blue
    case "blocked":
      return 208 // orange
    default:
      return 245 // gray
  }
}
