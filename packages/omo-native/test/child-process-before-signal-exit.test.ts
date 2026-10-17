import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const CHILD_PROCESS_MODULE = resolve(fileURLToPath(new URL("../bin/lib/child-process.js", import.meta.url)))

// Real process: the hook only matters on the path where the launcher kills itself with the signal it was
// sent, after a child that ignores that signal outlives the grace window.
test.skipIf(process.platform === "win32")("#given a child that ignores SIGTERM #then onBeforeSignalExit runs before the launcher dies of it", async () => {
  const root = mkdtempSync(join(tmpdir(), "omo-before-exit-"))
  const marker = join(root, "hook-ran")
  const source = `
import { writeFileSync } from "node:fs"
import { runChild } from ${JSON.stringify(CHILD_PROCESS_MODULE)}
await runChild(process.execPath, ["-e", "process.on('SIGTERM', () => {}); console.log('ready'); setTimeout(() => process.exit(0), 4000)"], {
  env: { ...process.env, OMO_SIGNAL_GRACE_MS: "300" },
  onBeforeSignalExit: () => writeFileSync(${JSON.stringify(marker)}, "x"),
})
`
  const parent = Bun.spawn([process.execPath, "-e", source], { stdout: "pipe", stderr: "ignore" })
  try {
    await parent.stdout.getReader().read() // the grandchild printed "ready", so the handler is installed
    parent.kill("SIGTERM")
    await parent.exited
    expect(parent.signalCode).toBe("SIGTERM")
    expect(existsSync(marker)).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
