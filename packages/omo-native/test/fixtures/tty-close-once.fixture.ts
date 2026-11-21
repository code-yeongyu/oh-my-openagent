import { mkdtempSync, openSync, readSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { openControllingTerminal } from "../../sync-phrase-tty"

// Opens the real controlling terminal, releases it, then grabs the freed descriptor numbers with ordinary files.
// If release closes a terminal descriptor twice, the late second close lands on one of these files.
const dir = mkdtempSync(join(tmpdir(), "omo-tty-close-"))
const probe = join(dir, "probe")
writeFileSync(probe, "probe")
const terminal = openControllingTerminal()
if (terminal === null) {
  console.log("NO_TTY")
  process.exit(3)
}
terminal.close()
const files = Array.from({ length: 8 }, () => openSync(probe, "r"))
for (let turn = 0; turn < 50; turn++) await new Promise<void>((resolve) => setImmediate(resolve))
const broken = files.filter((fd) => {
  try {
    readSync(fd, Buffer.alloc(5), 0, 5, 0)
    return false
  } catch {
    return true
  }
})
rmSync(dir, { recursive: true, force: true })
console.log(broken.length === 0 ? "CLOSED_ONCE" : `DOUBLE_CLOSE ${broken.length}`)
process.exit(0)
