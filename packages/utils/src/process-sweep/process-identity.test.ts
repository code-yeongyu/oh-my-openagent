import { describe, expect, test } from "bun:test"

import { parseLinuxProcessStartTicks, readProcessStartIdentity } from "./process-identity"

describe("process start identity", () => {
  test("#given linux stat with a parenthesized command #when parsed #then field 22 is stable", () => {
    const stat = "42 (worker with ) parens) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 987654 20"
    expect(parseLinuxProcessStartTicks(stat)).toBe("987654")
  })

  test("#given linux boot and process start facts #when read #then both identify the process lifetime", async () => {
    const identity = await readProcessStartIdentity(42, {
      platform: "linux",
      readText: (path) => Promise.resolve(path.includes("boot_id") ? "boot-123\n" : "42 (worker) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 987654 20"),
    })
    expect(identity).toBe("linux:boot-123:987654")
  })

  test("#given macOS and Windows start probes #when read #then platform-qualified identities are returned", async () => {
    const darwin = await readProcessStartIdentity(42, {
      platform: "darwin",
      execFileText: () => Promise.resolve("Sun Aug  2 12:34:56 2026\n"),
    })
    const windows = await readProcessStartIdentity(42, {
      platform: "win32",
      execFileText: () => Promise.resolve("638923456000000000\r\n"),
    })
    expect(darwin).toBe("darwin:Sun Aug  2 12:34:56 2026")
    expect(windows).toBe("win32:638923456000000000")
  })

  test("#given an unsupported or failed process probe #when read #then identity fails closed", async () => {
    const identity = await readProcessStartIdentity(42, {
      platform: "freebsd",
      execFileText: () => Promise.reject(new Error("probe unavailable")),
    })
    expect(identity).toBeNull()
  })
})
