import { describe, expect, onTestFinished, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { backgroundRemote, type DetachedSpawn } from "../remote-background-enable"
import { AFTER_LOGIN_FLAG } from "../remote-verbs"

// omo#13722: the background remote verb must never keep omo login alive: a detached child with no pipes back, hidden
// on Windows, unref'd. An npm launcher (.js) runs under this runtime; a compiled omo runs directly.
type Spawned = { command: string; args: readonly string[]; options: Parameters<DetachedSpawn>[2]; unrefs: number }

const recordingSpawn =
  (spawned: Spawned[]): DetachedSpawn =>
  (command, args, options) => {
    const call: Spawned = { command, args, options, unrefs: 0 }
    spawned.push(call)
    return { once: () => undefined, unref: () => void (call.unrefs += 1) }
  }

describe("omo login's background remote verb", () => {
  test("a compiled omo is started directly, detached, with no pipes, hidden, and unref'd", () => {
    const spawned: Spawned[] = []
    backgroundRemote("/opt/omo/omo", { spawn: recordingSpawn(spawned) })("enable")
    expect(spawned).toEqual([
      {
        command: "/opt/omo/omo",
        args: ["remote", "enable", AFTER_LOGIN_FLAG],
        options: { detached: true, stdio: "ignore", windowsHide: true, env: process.env },
        unrefs: 1,
      },
    ])
  })

  test("an npm launcher runs under this runtime, with the verb it was given", () => {
    const spawned: Spawned[] = []
    backgroundRemote("/lib/omo-ai/bin/omo.js", { spawn: recordingSpawn(spawned), execPath: "/usr/bin/bun" })(
      "bootstrap",
    )
    expect(spawned.map((s) => [s.command, ...s.args])).toEqual([
      ["/usr/bin/bun", "/lib/omo-ai/bin/omo.js", "remote", "bootstrap"],
    ])
  })

  test("an npm launcher started from a compiled omo runs under a JS runtime on PATH, never the compiled omo", () => {
    // A compiled omo login inside an npm-launched session inherits OMO_BIN=.../bin/omo.js (#13724 review L2).
    const bin = mkdtempSync(join(tmpdir(), "omo-runtime-"))
    onTestFinished(() => rmSync(bin, { recursive: true, force: true }))
    const node = join(bin, process.platform === "win32" ? "node.exe" : "node")
    writeFileSync(node, "")
    chmodSync(node, 0o755)
    const spawned: Spawned[] = []
    backgroundRemote("/lib/omo-ai/bin/omo.js", {
      spawn: recordingSpawn(spawned),
      execPath: "/opt/omo/omo",
      env: { PATH: bin },
    })("enable")
    expect(spawned.map((s) => [s.command, ...s.args])).toEqual([
      [node, "/lib/omo-ai/bin/omo.js", "remote", "enable", AFTER_LOGIN_FLAG],
    ])
  })
})
