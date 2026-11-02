/// <reference types="bun-types" />

// Every telemetry sender in the repo, driven through its real send path with hostname() stubbed to a
// sentinel: no captured payload, distinct id or property may carry the hostname or any hash of it (#11571).

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os, { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  TelemetryCaptureMessage,
  TelemetryOsProvider,
  TelemetryTransportFactory,
} from "@oh-my-opencode/telemetry-core"
import { isolateTelemetryEnv } from "../../../../test-support/telemetry-env.test-helpers"
import { FakeExtensionAPI } from "../../../omo-senpi/test-support/fake-extension-api"
import { recordSenpiDailyActive } from "../../../omo-senpi/src/components/telemetry/index"
import { createOmoNativeSessionComponent } from "../../../omo-senpi/src/components/telemetry/omo-native-session"
import {
  createEnabledEnv,
  createSilentLogger,
  withTempAgentDir,
} from "../../../omo-senpi/src/components/telemetry/telemetry.test-support"
import * as codexPostHog from "../../../omo-codex/src/telemetry/posthog"
import { trackCodexInstallTelemetry } from "../../../omo-codex/src/install/codex-install-telemetry"
import * as codexPluginPostHog from "../../../omo-codex/plugin/components/telemetry/src/posthog"
import { runSessionStartHook } from "../../../omo-codex/plugin/components/telemetry/src/codex-hook"

const SENTINEL = "SENTINEL-HOST-7f3a"
// Every prefix the codebase has ever hashed a hostname with, plus the bare hostname.
const HASH_PREFIXES = ["", "omo-senpi:", "omo-native:", "omo-codex:", "oh-my-openagent:"]
const FORBIDDEN = [
  SENTINEL,
  SENTINEL.toLowerCase(),
  ...HASH_PREFIXES.map((prefix) => createHash("sha256").update(`${prefix}${SENTINEL}`).digest("hex")),
]
// Before the old machine_hash sunset, so a transition-window property would still be attached.
const NOW = new Date("2026-07-03T04:05:06.000Z")

const SENTINEL_OS: TelemetryOsProvider = {
  arch: () => "arm64",
  cpus: () => [{ model: "Test CPU" }],
  hostname: () => SENTINEL,
  platform: () => "darwin",
  release: () => "26.0.0",
  totalmem: () => 16 * 1024 * 1024 * 1024,
  type: () => "Darwin",
}

type Recorder = { readonly messages: TelemetryCaptureMessage[]; readonly factory: TelemetryTransportFactory }

function createRecorder(): Recorder {
  const messages: TelemetryCaptureMessage[] = []
  return {
    messages,
    factory: () => ({
      capture: (message) => {
        messages.push(message)
      },
      flush: async () => undefined,
      shutdown: async () => undefined,
    }),
  }
}

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf)
  if (value === null || typeof value !== "object") return []
  return Object.entries(value).flatMap(([key, item]) => [key, ...keysOf(item)])
}

function hostLeaks(messages: readonly TelemetryCaptureMessage[]): string[] {
  const leaks: string[] = []
  for (const message of messages) {
    const text = JSON.stringify(message)
    for (const forbidden of FORBIDDEN) if (text.includes(forbidden)) leaks.push(`${message.event}: ${forbidden}`)
    if (keysOf(message).includes("machine_hash")) leaks.push(`${message.event}: machine_hash key`)
  }
  return leaks
}

const SENDERS: readonly (readonly [string, (dir: string, recorder: Recorder) => Promise<void>])[] = [
  ["OmO Native events (session_start, with the chained legacy ping)", async (_dir, recorder) => {
    await withTempAgentDir(async (agentDir) => {
      mkdirSync(agentDir, { recursive: true })
      writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: {} }))
      writeFileSync(join(agentDir, "settings.json"), "{}")
      const pi = new FakeExtensionAPI()
      createOmoNativeSessionComponent({
        env: createEnabledEnv(agentDir),
        hashSessionId: (raw) => `hashed:${raw}`,
        isConfigEnabled: () => true,
        now: NOW,
        osProvider: SENTINEL_OS,
        transportFactory: recorder.factory,
      }).register(pi, { config: pi, logger: createSilentLogger() })
      await pi.dispatch(
        "session_start",
        { type: "session_start", reason: "startup" },
        { cwd: "/repo", sessionManager: { getSessionId: () => "host-identity" } },
      )
    })
  }],
  ["omo_senpi_daily_active", async (dir, recorder) => {
    await withTempAgentDir(async (agentDir) => {
      await recordSenpiDailyActive({
        env: createEnabledEnv(agentDir),
        now: NOW,
        osProvider: SENTINEL_OS,
        stateDir: dir,
        timeoutMs: 1_000,
        transportFactory: recorder.factory,
      })
    })
  }],
  ["omo_codex_daily_active (installer)", async (_dir, recorder) => {
    process.env.POSTHOG_API_KEY = "test-api-key"
    codexPostHog.__setOsProviderForTesting(SENTINEL_OS)
    codexPostHog.__setTransportFactoryForTesting(recorder.factory)
    codexPostHog.__setActivityStateProviderForTesting(() => ({ dayUTC: "2026-07-03", captureDaily: true }))
    try {
      await trackCodexInstallTelemetry()
    } finally {
      codexPostHog.__resetOsProviderForTesting()
      codexPostHog.__resetTransportFactoryForTesting()
      codexPostHog.__resetActivityStateProviderForTesting()
    }
  }],
  ["omo_codex_daily_active (plugin SessionStart hook)", async (dir, recorder) => {
    await runSessionStartHook(
      {
        session_id: "session-123",
        transcript_path: null,
        cwd: "/repo",
        hook_event_name: "SessionStart",
        model: "gpt-5.5",
        permission_mode: "default",
        source: "startup",
      },
      {
        createClient: () => codexPluginPostHog.__createPluginPostHogForTesting({
          env: { POSTHOG_API_KEY: "test-api-key" },
          now: NOW,
          osProvider: SENTINEL_OS,
          stateDir: dir,
          transportFactory: recorder.factory,
        }),
      },
    )
  }],
  ["OpenCode plugin ping (omo_daily_active)", async (_dir, recorder) => {
    process.env.POSTHOG_API_KEY = "test-api-key"
    const posthog: typeof import("./posthog") = await import(`./posthog?host-identity=${Date.now()}-${Math.random()}`)
    posthog.__setOsProviderForTesting(SENTINEL_OS)
    posthog.__setTransportFactoryForTesting(recorder.factory)
    posthog.__setActivityStateProviderForTesting(() => ({ dayUTC: "2026-07-03", captureDaily: true }))
    try {
      posthog.recordPluginTelemetry({ configEnabled: true })
    } finally {
      posthog.__resetOsProviderForTesting()
      posthog.__resetTransportFactoryForTesting()
      posthog.__resetActivityStateProviderForTesting()
    }
  }],
]

describe("telemetry identities never derive from the host", () => {
  let restoreTelemetryEnv: () => void
  let dir: string

  beforeEach(() => {
    restoreTelemetryEnv = isolateTelemetryEnv()
    delete process.env.OMO_DISABLE_POSTHOG
    dir = mkdtempSync(join(tmpdir(), "omo-telemetry-host-identity-"))
    // Any sender that reads the real os module instead of the injected provider sees the sentinel too.
    spyOn(os, "hostname").mockReturnValue(SENTINEL)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    restoreTelemetryEnv()
  })

  it.each(SENDERS)("#given hostname() is a sentinel #when %s sends #then no payload carries the hostname or a hash of it", async (_name, send) => {
    // given
    const recorder = createRecorder()

    // when
    await send(dir, recorder)

    // then
    expect(recorder.messages.length).toBeGreaterThan(0)
    expect(hostLeaks(recorder.messages)).toEqual([])
  })
})
