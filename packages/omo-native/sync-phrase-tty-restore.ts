import { writeSync } from "node:fs"

export const ALT_SCREEN_ON = "\u001b[?1049h\u001b[H\u001b[2J"
export const ALT_SCREEN_OFF = "\u001b[2J\u001b[H\u001b[?1049l"

const RESTORED_SIGNALS = ["SIGHUP", "SIGTERM", "SIGINT"] as const

/**
 * Runs `restore` when one of RESTORED_SIGNALS arrives, then lets the signal end the process as it would have:
 * when no other listener is left for it, it is raised again with the default action. Returns the remover.
 */
export function restoreOnSignal(restore: () => void): () => void {
  const stop = () => {
    for (const signal of RESTORED_SIGNALS) process.off(signal, onSignal)
  }
  function onSignal(signal: NodeJS.Signals) {
    stop()
    restore()
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal)
  }
  for (const signal of RESTORED_SIGNALS) process.on(signal, onSignal)
  return stop
}

/** Follows the alternate-screen switches written through `write`, as the terminal itself does. */
export function alternateScreenTracker(write: (text: string) => void) {
  let alternate = false
  const tracked = (text: string) => {
    write(text)
    const on = text.lastIndexOf("\u001b[?1049h")
    const off = text.lastIndexOf("\u001b[?1049l")
    if (on !== off) alternate = on > off
  }
  return {
    write: tracked,
    leave: () => {
      if (alternate) tracked(ALT_SCREEN_OFF)
    },
  }
}

/** A whole write to a blocking descriptor, so the last bytes before a signal's exit reach the terminal. */
export const writeAll = (fd: number, text: string) => {
  const bytes = Buffer.from(text, "utf8")
  for (let at = 0; at < bytes.length;) at += writeSync(fd, bytes, at)
}
