/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { reapLspDaemons } from "./lsp-daemon-reaper"
import {
  createLegacyCodexHome,
  legacyEndpointFor,
  liveLegacyEndpointFor,
  normalizeWindowsNodeCandidate,
  removePathIfPresent,
  writeLegacyVersionState,
  writeSymlinkedLegacyMetadata,
} from "./lsp-daemon-reaper.test-support"

const cleanupRoots: string[] = []

afterEach(async () => {
  for (const root of cleanupRoots.splice(0)) await removePathIfPresent(root)
})

function trackRoot(root: string): string {
  cleanupRoots.push(root)
  return root
}

describe("reapLspDaemons", () => {
  test("#given a legacy fixture home #when creating it #then it uses the platform-safe temp root that the reaper also validates", () => {
    const codexHome = trackRoot(createLegacyCodexHome("omo-reap-temp-root-"))
    const expectedRoot = process.platform === "win32" ? tmpdir() : "/tmp"

    expect(codexHome.startsWith(expectedRoot)).toBe(true)
  })

  test("#given Git Bash resolves node as an MSYS path #when normalizing for Windows spawn #then it returns a native executable path", () => {
    const nodePath = normalizeWindowsNodeCandidate("/c/hostedtoolcache/windows/node/24.18.0/x64/node")

    expect(nodePath).toBe("C:\\hostedtoolcache\\windows\\node\\24.18.0\\x64\\node.exe")
  })

  test("#given PowerShell resolves node as a native path #when normalizing for Windows spawn #then it preserves the executable path", () => {
    const nodePath = normalizeWindowsNodeCandidate("C:\\hostedtoolcache\\windows\\node\\24.18.0\\x64\\node.exe")

    expect(nodePath).toBe("C:\\hostedtoolcache\\windows\\node\\24.18.0\\x64\\node.exe")
  })

  test("#given legacy live endpoint selection #when targeting Unix and Windows #then it chooses a platform-valid fixture endpoint", () => {
    const codexHome = trackRoot(createLegacyCodexHome("omo-reap-live-endpoint-"))

    const unixEndpoint = liveLegacyEndpointFor({ codexHome, version: "0.1.0", platform: "linux" })
    const windowsEndpoint = liveLegacyEndpointFor({ codexHome, version: "0.1.0", platform: "win32" })
    const unixSuffix = process.platform === "win32"
      ? "\\codex-lsp\\daemon\\v0.1.0/daemon.sock"
      : "/codex-lsp/daemon/v0.1.0/daemon.sock"

    expect(unixEndpoint.endsWith(unixSuffix)).toBe(true)
    expect(windowsEndpoint.startsWith("\\\\.\\pipe\\omo-lsp-0.1.0-")).toBe(true)
  })

  test("#given a native Windows temp Codex home #when selecting a Unix legacy endpoint #then it preserves the Windows version path and appends the socket leaf", () => {
    const codexHome = "D:\\a\\_temp\\omo-reap-live-endpoint-native"

    const endpoint = legacyEndpointFor({ codexHome, version: "0.1.0", kind: "natural", platform: "linux" })

    expect(endpoint).toBe("D:\\a\\_temp\\omo-reap-live-endpoint-native\\codex-lsp\\daemon\\v0.1.0/daemon.sock")
  })

  test("#given a stale hashed Unix endpoint #when reaping #then it removes the dead legacy directory idempotently", async () => {
    const codexHome = trackRoot(createLegacyCodexHome("omo-reap-stale-"))
    const version = await writeLegacyVersionState({
      codexHome,
      version: "0.1.0",
      pid: "333",
      endpoint: legacyEndpointFor({ codexHome, version: "0.1.0", kind: "hashed", platform: "linux", tempDir: tmpdir() }),
    })

    const deps = { platform: "linux" as const, tmpDir: tmpdir() }
    const firstRun = await reapLspDaemons(codexHome, deps)
    const secondRun = await reapLspDaemons(codexHome, deps)

    expect(firstRun).toEqual([
      {
        version: "0.1.0",
        status: "removed",
        reason: "removed stale legacy daemon state",
      },
    ])
    expect(secondRun).toEqual([])
    expect(existsSync(version.versionDir)).toBe(false)
  })

  test("#given a Unix hashed endpoint under Windows reaper semantics #when reaping #then it fails closed as outside the frozen vectors", async () => {
    const codexHome = trackRoot(createLegacyCodexHome("omo-reap-stale-win32-"))
    const version = await writeLegacyVersionState({
      codexHome,
      version: "0.1.0",
      pid: "333",
      endpoint: legacyEndpointFor({ codexHome, version: "0.1.0", kind: "hashed", platform: "linux", tempDir: tmpdir() }),
    })

    const reaped = await reapLspDaemons(codexHome, { platform: "win32", tmpDir: tmpdir() })

    expect(reaped).toEqual([
      {
        version: "0.1.0",
        status: "removed",
        reason: "removed legacy daemon state with an endpoint outside the frozen vectors",
      },
    ])
    expect(existsSync(version.versionDir)).toBe(false)
  })

  test("#given malformed legacy metadata #when reaping #then it removes the stale state with a structured reason", async () => {
    const codexHome = trackRoot(createLegacyCodexHome("omo-reap-malformed-"))
    const versionDir = join(codexHome, "codex-lsp", "daemon", "v0.1.0")
    await mkdir(versionDir, { recursive: true })
    await writeFile(join(versionDir, "daemon.pid"), "not-a-pid\n")
    await writeFile(join(versionDir, "daemon.endpoint"), `${join(versionDir, "daemon.sock")}\n`)

    const reaped = await reapLspDaemons(codexHome)

    expect(reaped).toEqual([
      {
        version: "0.1.0",
        status: "removed",
        reason: "removed malformed legacy daemon metadata",
      },
    ])
    expect(existsSync(versionDir)).toBe(false)
  })

  test("#given a non-version entry under the legacy daemon root #when reaping #then it removes the entry with a structured version reason", async () => {
    const codexHome = trackRoot(createLegacyCodexHome("omo-reap-invalid-version-"))
    const versionDir = join(codexHome, "codex-lsp", "daemon", "notes")
    await mkdir(versionDir, { recursive: true })

    const reaped = await reapLspDaemons(codexHome)

    expect(reaped).toEqual([
      {
        version: "notes",
        status: "removed",
        reason: "removed invalid legacy version entry",
      },
    ])
    expect(existsSync(versionDir)).toBe(false)
  })

  test("#given symlinked metadata files #when reaping #then it refuses to follow them and removes only the version dir", async () => {
    const codexHome = trackRoot(createLegacyCodexHome("omo-reap-symlink-"))
    const outside = trackRoot(await mkdtemp(join(tmpdir(), "omo-reap-symlink-outside-")))
    const version = await writeSymlinkedLegacyMetadata({
      codexHome,
      version: "0.1.0",
      targetPath: join(outside, "foreign.txt"),
    })

    const reaped = await reapLspDaemons(codexHome)

    expect(reaped).toEqual([
      {
        version: "0.1.0",
        status: "removed",
        reason: "removed non-regular legacy daemon metadata",
      },
    ])
    expect(existsSync(version.versionDir)).toBe(false)
    expect(existsSync(join(outside, "foreign.txt"))).toBe(true)
  })

  test("#given an endpoint outside the frozen legacy vectors #when reaping #then it removes the version dir without probing or signaling", async () => {
    const codexHome = trackRoot(createLegacyCodexHome("omo-reap-foreign-endpoint-"))
    const version = await writeLegacyVersionState({
      codexHome,
      version: "0.1.0",
      pid: "555",
      endpoint: join(codexHome, "not-legacy.sock"),
    })

    const reaped = await reapLspDaemons(codexHome)

    expect(reaped).toEqual([
      {
        version: "0.1.0",
        status: "removed",
        reason: "removed legacy daemon state with an endpoint outside the frozen vectors",
      },
    ])
    expect(existsSync(version.versionDir)).toBe(false)
  })

  test("#given a live Windows named pipe legacy daemon #when reaping #then it defers instead of signaling a pid it cannot attest", async () => {
    const codexHome = trackRoot(createLegacyCodexHome("omo-reap-win32-"))
    const version = await writeLegacyVersionState({
      codexHome,
      version: "0.1.0",
      pid: "777",
      endpoint: legacyEndpointFor({ codexHome, version: "0.1.0", kind: "windowsPipe" }),
    })
    const killed: number[] = []
    const deps = {
      platform: "win32" as const,
      tmpDir: "C:\\Temp",
      probeLegacyJsonRpc: async () => true,
      killProcess: (pid: number) => {
        killed.push(pid)
        return true
      },
    }

    const reaped = await reapLspDaemons(codexHome, deps)

    expect(reaped).toEqual([
      {
        version: "0.1.0",
        status: "deferred",
        reason: "legacy named pipe responded but Windows cannot prove pid ownership safely",
      },
    ])
    expect(killed).toEqual([])
    expect(existsSync(version.versionDir)).toBe(true)
  })

})
