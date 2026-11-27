import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import type { TelemetryTransport, TelemetryTransportFactory } from "@oh-my-opencode/telemetry-core"

import { __createPostHogForTesting } from "./posthog"

function recordingFactory(calls: unknown[]): TelemetryTransportFactory {
  const transport: TelemetryTransport = {
    capture: (message) => {
      calls.push(message)
    },
    captureImmediate: async (message) => {
      calls.push(message)
    },
    flush: async () => undefined,
    shutdown: async () => undefined,
  }
  return () => transport
}

describe("omo-codex telemetry config gate", () => {
  test("#given user config telemetry.enabled false #when the client tracks activity #then nothing is sent", () => {
    const home = mkdtempSync(join(tmpdir(), "omo-codex-cfg-"))
    const stateDir = mkdtempSync(join(tmpdir(), "omo-codex-state-"))
    try {
      mkdirSync(join(home, ".omo"), { recursive: true })
      writeFileSync(join(home, ".omo", "omo.jsonc"), '{ "telemetry": { "enabled": false } }\n')
      const calls: unknown[] = []

      const client = __createPostHogForTesting("cli", {
        env: { HOME: home, PATH: process.env.PATH ?? "" },
        now: new Date("2026-11-25T00:00:00Z"),
        stateDir,
        transportFactory: recordingFactory(calls),
      })
      client.trackActive("install_started")

      expect(calls).toHaveLength(0)
      expect(existsSync(join(stateDir, "posthog-activity.json"))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
      rmSync(stateDir, { recursive: true, force: true })
    }
  })

  test("#given user config telemetry.enabled true #when the client tracks activity #then the ping is sent", () => {
    const home = mkdtempSync(join(tmpdir(), "omo-codex-cfg-"))
    const stateDir = mkdtempSync(join(tmpdir(), "omo-codex-state-"))
    try {
      mkdirSync(join(home, ".omo"), { recursive: true })
      writeFileSync(join(home, ".omo", "omo.jsonc"), '{ "telemetry": { "enabled": true } }\n')
      const calls: unknown[] = []

      const client = __createPostHogForTesting("cli", {
        env: { HOME: home, PATH: process.env.PATH ?? "" },
        now: new Date("2026-11-25T00:00:00Z"),
        stateDir,
        transportFactory: recordingFactory(calls),
      })
      client.trackActive("install_started")

      expect(calls).toHaveLength(1)
    } finally {
      rmSync(home, { recursive: true, force: true })
      rmSync(stateDir, { recursive: true, force: true })
    }
  })
})
