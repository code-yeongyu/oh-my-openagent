import { ChildProcess } from "node:child_process"
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { createConnection } from "node:net"
import { join } from "node:path"

const runDir = process.env.FIXTURE_SUPERVISOR_DIR ?? process.argv[2]
const shim = join(runDir, "bootstrap-without-status")
if (process.env.FIXTURE_SUPERVISOR_DIR) {
  // The shim execs this fixture at the actual bootstrap/guard PID.
  process.argv.splice(1, 1)
  if (process.argv[2] === "--child-bootstrap") process.execPath = shim
  if (process.argv[2] === "--group-guard") {
    if (existsSync(join(runDir, "stall-before-ready"))) {
      const { env } = JSON.parse(readFileSync(join(runDir, "launch.json"), "utf8"))
      await new Promise<void>((resolve, reject) =>
        createConnection(Number(env.OMO_MEMORY_SUPERVISOR_EXIT_PORT), "127.0.0.1", resolve).once("error", reject),
      )
      writeFileSync(join(runDir, "guard.pid"), String(process.pid))
      process.kill(process.pid, "SIGSTOP")
    } else writeFileSync(join(runDir, "guard.pid"), String(process.pid))
  }
} else {
  // Observe actual group signals and close notifications in the outer supervisor only.
  const kill = process.kill
  process.kill = (pid, signal) => {
    if (pid <= 0 && signal !== 0) {
      appendFileSync(join(runDir, "external-signals.jsonl"), `${JSON.stringify({ pid, signal })}\n`)
      return true
    }
    return kill(pid, signal)
  }
  const emit = ChildProcess.prototype.emit
  ChildProcess.prototype.emit = function (event: string | symbol, ...args: unknown[]) {
    const result = emit.call(this, event, ...args)
    if (event === "close" && this.spawnargs.includes("--child-bootstrap")) {
      writeFileSync(join(runDir, "bootstrap-closed"), "")
    }
    return result
  }
  writeFileSync(
    shim,
    '#!/bin/sh\nif [ "$2" = "--child-bootstrap" ]; then exec 3>/dev/null; fi\nexec "$FIXTURE_BOOTSTRAP_RUNTIME" "$FIXTURE_SPY" "$@"\n',
    { mode: 0o700 },
  )
  process.env.FIXTURE_SUPERVISOR_DIR = runDir
  process.env.FIXTURE_SPY = import.meta.path
  process.env.FIXTURE_BOOTSTRAP_RUNTIME = process.execPath
  process.execPath = shim
}
await import("../memory-run-supervisor")
