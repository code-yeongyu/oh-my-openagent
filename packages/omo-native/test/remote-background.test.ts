import { describe, expect, test } from "bun:test"

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
})
