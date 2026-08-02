import { describe, expect, test } from "bun:test"

import { isProcessStartIdentity, parseLinuxProcessStartTicks, readProcessStartIdentity } from "./process-identity"

describe("process start identity", () => {
  test("#given persisted process identities #when validated #then only canonical platform formats pass", () => {
    expect(isProcessStartIdentity("linux:12345678-1234-1234-1234-123456789abc:987654")).toBeTrue()
    expect(isProcessStartIdentity("darwin:203145485856")).toBeTrue()
    expect(isProcessStartIdentity("win32:638923456000000000")).toBeTrue()
    expect(isProcessStartIdentity("garbage")).toBeFalse()
    expect(isProcessStartIdentity("darwin:not-a-kernel-time")).toBeFalse()
    expect(isProcessStartIdentity("darwin:0")).toBeFalse()
  })

  test("#given linux stat with a parenthesized command #when parsed #then field 22 is stable", () => {
    const stat = "42 (worker with ) parens) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 987654 20"
    expect(parseLinuxProcessStartTicks(stat)).toBe("987654")
  })

  test("#given linux boot and process start facts #when read #then both identify the process lifetime", async () => {
    const identity = await readProcessStartIdentity(42, {
      platform: "linux",
      readText: (path) => Promise.resolve(path.includes("boot_id") ? "12345678-1234-1234-1234-123456789abc\n" : "42 (worker) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 987654 20"),
    })
    expect(identity).toBe("linux:12345678-1234-1234-1234-123456789abc:987654")
  })

  test("#given malformed Linux boot identity #when read #then identity fails closed", async () => {
    const identity = await readProcessStartIdentity(42, {
      platform: "linux",
      readText: (path) => Promise.resolve(path.includes("boot_id") ? "\n" : "42 (worker) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 987654 20"),
    })
    expect(identity).toBeNull()
  })

  test("#given macOS and Windows start probes #when read #then precise platform-qualified identities are returned", async () => {
    const darwin = await readProcessStartIdentity(42, {
      platform: "darwin",
      readDarwinStartAbstime: () => Promise.resolve("203145485856"),
    })
    let invokedWindowsExecutable = ""
    const windows = await readProcessStartIdentity(42, {
      platform: "win32",
      systemRoot: "C:\\Windows",
      execFileText: (file) => {
        invokedWindowsExecutable = file
        return Promise.resolve("638923456000000000\r\n")
      },
    })
    expect(darwin).toBe("darwin:203145485856")
    expect(windows).toBe("win32:638923456000000000")
    expect(invokedWindowsExecutable).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
  })

  test("#given Windows has no absolute system root #when read #then executable lookup fails closed", async () => {
    let invoked = false
    const identity = await readProcessStartIdentity(42, {
      platform: "win32",
      systemRoot: "relative-windows",
      execFileText: () => {
        invoked = true
        return Promise.resolve("638923456000000000")
      },
    })
    expect(identity).toBeNull()
    expect(invoked).toBeFalse()
  })

  test("#given an unsupported or failed process probe #when read #then identity fails closed", async () => {
    const identity = await readProcessStartIdentity(42, {
      platform: "freebsd",
      execFileText: () => Promise.reject(new Error("probe unavailable")),
    })
    expect(identity).toBeNull()
    const nonErrorFailure = await readProcessStartIdentity(42, {
      platform: "darwin",
      readDarwinStartAbstime: () => Promise.reject("probe unavailable"),
    })
    expect(nonErrorFailure).toBeNull()
  })

  test.skipIf(process.platform !== "darwin")("#given a live macOS process #when read twice #then its kernel start identity is stable", async () => {
    const first = await readProcessStartIdentity(process.pid)
    const second = await readProcessStartIdentity(process.pid)
    expect(first).toMatch(/^darwin:\d+$/)
    expect(second).toBe(first)
  })
})
