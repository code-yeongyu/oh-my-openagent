import { appendFileSync, fstatSync, statSync } from "node:fs"

import { generateRecoveryPhrase } from "../../../memory-core/src/sync/recovery/phrase"
import { lazyTerminalSurface, openControllingTerminal } from "../../sync-phrase-tty"

// argv: <mode> <report file>. The pty is this process's terminal, so the report goes to a file.
//   signal:  the ceremony waits on its first prompt until the driver ends the process with a signal.
//   survive: the host also listens for SIGTERM, so the signal does not end the process; the host's own listener
//            reports the listener counts once every listener has run, then exits 0.
//   close:   the driver cancels the prompt with Ctrl+C; the normal close path reports the listener counts and,
//            once nothing is left to run, the number of descriptors open on the terminal.
const [mode, report = ""] = process.argv.slice(2)
const SIGNALS = ["SIGHUP", "SIGTERM", "SIGINT"] as const
const listeners = () => SIGNALS.map((signal) => process.listenerCount(signal)).join(",")
const terminalDescriptors = () => {
  // A descriptor opened through /dev/tty reports that node's device, not the pty behind it, so both are counted.
  const terminal = new Set([fstatSync(0).rdev, statSync("/dev/tty").rdev])
  let count = 0
  for (let fd = 0; fd < 256; fd++) {
    try {
      if (terminal.has(fstatSync(fd).rdev)) count++
    } catch {}
  }
  return count
}
const say = (line: string) => appendFileSync(report, `${line}\n`)

if (mode === "survive")
  process.on("SIGTERM", () =>
    setImmediate(() => {
      say(`AFTER_SIGNAL listeners=${listeners()}`)
      process.exit(0)
    }),
  )
say(`BEFORE listeners=${listeners()} descriptors=${terminalDescriptors()}`)
const surface = lazyTerminalSurface(openControllingTerminal, "fixture account")
const shown = surface.show(generateRecoveryPhrase((bytes) => bytes.fill(7)))
say(`OPEN listeners=${listeners()}`)
const confirmed = await shown
surface.done()
say(`AFTER_CLOSE confirmed=${confirmed} listeners=${listeners()}`)
process.once("beforeExit", () => say(`EXIT descriptors=${terminalDescriptors()}`))
