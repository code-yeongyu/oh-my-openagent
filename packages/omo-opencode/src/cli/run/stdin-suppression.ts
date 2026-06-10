type StdinLike = {
  isTTY?: boolean
  isRaw?: boolean
  setRawMode?: (mode: boolean) => void
  isPaused?: () => boolean
  resume: () => void
  pause: () => void
  on: (event: "data", listener: (chunk: string | Uint8Array) => void) => void
  removeListener: (event: "data", listener: (chunk: string | Uint8Array) => void) => void
}

function includesCtrlC(chunk: string | Uint8Array): boolean {
  const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
  return text.includes("\u0003")
}

export function suppressRunInput(
  stdin: StdinLike = process.stdin,
  onInterrupt: () => void = () => {
    process.kill(process.pid, "SIGINT")
  }
): () => void {
  if (!stdin.isTTY) {
    return () => {}
  }

  const wasRaw = stdin.isRaw === true
  const wasPaused = stdin.isPaused?.() ?? false
  const canSetRawMode = typeof stdin.setRawMode === "function"

  const onData = (chunk: string | Uint8Array) => {
    if (includesCtrlC(chunk)) {
      onInterrupt()
    }
  }

  if (canSetRawMode) {
    stdin.setRawMode!(true)
  }
  stdin.on("data", onData)
  stdin.resume()

  return () => {
    stdin.removeListener("data", onData)
    if (canSetRawMode) {
      stdin.setRawMode!(wasRaw)
    }
    if (wasPaused) {
      stdin.pause()
    }
  }
}
