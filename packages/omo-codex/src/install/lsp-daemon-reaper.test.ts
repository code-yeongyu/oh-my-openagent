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
  test("#given a stale hashed Unix endpoint #when reaping #then it removes the dead legacy directory idempotently", async () => {
    const codexHome = trackRoot(createLegacyCodexHome("omo-reap-stale-"))
    const version = await writeLegacyVersionState({
      codexHome,
      version: "0.1.0",
      pid: "333",
      endpoint: legacyEndpointFor({ codexHome, version: "0.1.0", kind: "hashed", tempDir: tmpdir() }),
    })

    const firstRun = await reapLspDaemons(codexHome)
    const secondRun = await reapLspDaemons(codexHome)

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
