import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isReplyListenerDaemonProcess, REPLY_LISTENER_DAEMON_IDENTITY_MARKER } from "../reply-listener-process"

// The fake-spawn tests prove which branch runs; only a real child proves the platform
// command line lookup works (#7885: the win32 branch shipped with zero Windows execution).
// The child reports its own pid after exec: probing the spawn-returned pid immediately
// can race the exec and read the pre-exec command line (observed on ubuntu CI).
const scriptDir = mkdtempSync(join(tmpdir(), "openclaw-reply-listener-identity-"))
const idleScript = join(scriptDir, "idle-daemon.ts")
writeFileSync(
  idleScript,
  `const fs = require("node:fs")\nfs.writeFileSync(process.argv[2] + ".ready", String(process.pid))\nsetTimeout(() => {}, 60_000)\n`,
)

function spawnIdleChild(name: string, extraArgs: readonly string[]) {
  return {
    readyPath: join(scriptDir, `${name}.ready`),
    child: Bun.spawn([process.execPath, "run", idleScript, join(scriptDir, name), ...extraArgs], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    }),
  }
}

async function awaitReady(readyPath: string): Promise<number> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (existsSync(readyPath)) {
      const pid = Number(readFileSync(readyPath, "utf-8").trim())
      if (Number.isSafeInteger(pid) && pid > 0) return pid
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`waited 20s for the spawned child's ready marker, never appeared: ${readyPath}`)
}

afterAll(() => {
  rmSync(scriptDir, { recursive: true, force: true })
})

describe("isReplyListenerDaemonProcess against real processes", () => {
  test(
    "#given live children with and without the daemon marker #when probing their self-reported pids #then only the marked child is the daemon and a dead pid is not",
    async () => {
      const marked = spawnIdleChild("marked", [REPLY_LISTENER_DAEMON_IDENTITY_MARKER])
      const unmarked = spawnIdleChild("unmarked", [])
      const markedPid = await awaitReady(marked.readyPath)
      const unmarkedPid = await awaitReady(unmarked.readyPath)
      try {
        expect(await isReplyListenerDaemonProcess(markedPid)).toBe(true)
        expect(await isReplyListenerDaemonProcess(unmarkedPid)).toBe(false)
      } finally {
        marked.child.kill()
        unmarked.child.kill()
        await Promise.all([marked.child.exited, unmarked.child.exited])
      }
      expect(await isReplyListenerDaemonProcess(markedPid)).toBe(false)
    },
    30_000,
  )
})
