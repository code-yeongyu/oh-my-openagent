/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { reapLspDaemons } from "./lsp-daemon-reaper"
import {
  createLegacyCodexHome,
  legacyEndpointFor,
  liveLegacyEndpointFor,
  removePathIfPresent,
  startIdleNodeProcess,
  startLegacyDaemonProcess,
  stopChild,
  waitForChildExit,
  waitForChildReady,
  writeLegacyVersionState,
  type SpawnedChild,
} from "./lsp-daemon-reaper.test-support"

const posixOnly = process.platform === "win32" ? test.skip : test
const windowsOnly = process.platform === "win32" ? test : test.skip

const cleanupRoots: string[] = []
const cleanupChildren: SpawnedChild[] = []

afterEach(async () => {
  for (const child of cleanupChildren.splice(0)) await stopChild(child)
  for (const root of cleanupRoots.splice(0)) await removePathIfPresent(root)
})

function trackRoot(root: string): string {
  cleanupRoots.push(root)
  return root
}

function trackChild(child: SpawnedChild): SpawnedChild {
  cleanupChildren.push(child)
  return child
}

describe("reapLspDaemons live ownership", () => {
  posixOnly(
    "#given a proven legacy daemon owner #when reaping #then it SIGTERMs the process waits for exit and removes only that version dir",
    async () => {
      const codexHome = trackRoot(createLegacyCodexHome("omo-reap-owned-"))
      const endpoint = legacyEndpointFor({ codexHome, version: "0.1.0", kind: "natural" })
      const daemon = trackChild(startLegacyDaemonProcess({ endpoint }))
      await waitForChildReady(daemon)
      const version = await writeLegacyVersionState({
        codexHome,
        version: "0.1.0",
        pid: String(daemon.pid ?? 0),
        endpoint,
      })

      const reaped = await reapLspDaemons(codexHome, {
        attestLegacyDaemonOwnership: async (input) => input.pid === daemon.pid,
      })

      expect(reaped).toEqual([
        {
          version: "0.1.0",
          status: "terminated",
          reason: "terminated proven owned legacy daemon",
        },
      ])
      expect(await waitForChildExit(daemon, 5_000)).toBe(true)
      expect(existsSync(version.versionDir)).toBe(false)
    },
    { timeout: 15_000 },
  )

  posixOnly(
    "#given a responding endpoint and a reused pid #when reaping #then it defers without signaling the unrelated process",
    async () => {
      const codexHome = trackRoot(createLegacyCodexHome("omo-reap-reused-pid-"))
      const endpoint = legacyEndpointFor({ codexHome, version: "0.1.0", kind: "natural" })
      const daemon = trackChild(startLegacyDaemonProcess({ endpoint }))
      const unrelated = trackChild(startIdleNodeProcess())
      await waitForChildReady(daemon)
      const version = await writeLegacyVersionState({
        codexHome,
        version: "0.1.0",
        pid: String(unrelated.pid ?? 0),
        endpoint,
      })

      const reaped = await reapLspDaemons(codexHome, {
        attestLegacyDaemonOwnership: async (input) => input.pid === daemon.pid,
      })

      expect(reaped).toEqual([
        {
          version: "0.1.0",
          status: "deferred",
          reason: "legacy endpoint responded but pid ownership was not proven",
        },
      ])
      expect(await waitForChildExit(unrelated, 250)).toBe(false)
      expect(existsSync(version.versionDir)).toBe(true)
    },
    { timeout: 15_000 },
  )

  posixOnly(
    "#given a proven owner that ignores SIGTERM #when reaping #then it defers with a timeout warning and preserves the version dir",
    async () => {
      const codexHome = trackRoot(createLegacyCodexHome("omo-reap-timeout-"))
      const endpoint = legacyEndpointFor({ codexHome, version: "0.1.0", kind: "natural" })
      const daemon = trackChild(startLegacyDaemonProcess({ endpoint, ignoreSigterm: true }))
      await waitForChildReady(daemon)
      const version = await writeLegacyVersionState({
        codexHome,
        version: "0.1.0",
        pid: String(daemon.pid ?? 0),
        endpoint,
      })

      const reaped = await reapLspDaemons(codexHome, {
        attestLegacyDaemonOwnership: async (input) => input.pid === daemon.pid,
      })

      expect(reaped).toEqual([
        {
          version: "0.1.0",
          status: "deferred",
          reason: "timed out waiting 5000ms for the proven legacy daemon to exit",
        },
      ])
      expect(await waitForChildExit(daemon, 250)).toBe(false)
      expect(existsSync(version.versionDir)).toBe(true)
    },
    { timeout: 15_000 },
  )

  posixOnly(
    "#given a first deferred reused pid run and a later dead endpoint #when reaping twice #then the follow-up pass removes the stale directory",
    async () => {
      const codexHome = trackRoot(createLegacyCodexHome("omo-reap-idempotent-"))
      const endpoint = legacyEndpointFor({ codexHome, version: "0.1.0", kind: "natural" })
      const daemon = trackChild(startLegacyDaemonProcess({ endpoint }))
      const unrelated = trackChild(startIdleNodeProcess())
      await waitForChildReady(daemon)
      const version = await writeLegacyVersionState({
        codexHome,
        version: "0.1.0",
        pid: String(unrelated.pid ?? 0),
        endpoint,
      })

      const firstRun = await reapLspDaemons(codexHome)
      await stopChild(daemon)
      const secondRun = await reapLspDaemons(codexHome)

      expect(firstRun).toEqual([
        {
          version: "0.1.0",
          status: "deferred",
          reason: "legacy endpoint responded but pid ownership was not proven",
        },
      ])
      expect(secondRun).toEqual([
        {
          version: "0.1.0",
          status: "removed",
          reason: "removed stale legacy daemon state",
        },
      ])
      expect(existsSync(version.versionDir)).toBe(false)
    },
    { timeout: 15_000 },
  )

  windowsOnly(
    "#given a live Windows named pipe legacy daemon #when reaping #then it defers without sending POSIX signals",
    async () => {
      const codexHome = trackRoot(createLegacyCodexHome("omo-reap-win32-live-"))
      const endpoint = liveLegacyEndpointFor({ codexHome, version: "0.1.0" })
      const daemon = trackChild(startLegacyDaemonProcess({ endpoint }))
      await waitForChildReady(daemon)
      const version = await writeLegacyVersionState({
        codexHome,
        version: "0.1.0",
        pid: String(daemon.pid ?? 0),
        endpoint,
      })

      const reaped = await reapLspDaemons(codexHome)

      expect(reaped).toEqual([
        {
          version: "0.1.0",
          status: "deferred",
          reason: "legacy named pipe responded but Windows cannot prove pid ownership safely",
        },
      ])
      expect(await waitForChildExit(daemon, 250)).toBe(false)
      expect(existsSync(version.versionDir)).toBe(true)
    },
    { timeout: 15_000 },
  )
})
