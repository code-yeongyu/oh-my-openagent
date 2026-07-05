import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  getTelemetryActivityStateFilePath,
  type TelemetryCaptureMessage,
  type TelemetryEnv,
  type TelemetryOsProvider,
  type TelemetryTransportFactory,
} from "@oh-my-opencode/telemetry-core"

import type { ComponentLogger } from "../../extension/types"

export type RecordedTransport = {
  readonly messages: readonly TelemetryCaptureMessage[]
  readonly factory: TelemetryTransportFactory
}

export const FIXED_NOW = new Date("2026-07-03T04:05:06.000Z")

export function createOsProvider(hostname: string): TelemetryOsProvider {
  return {
    arch: () => "arm64",
    cpus: () => [{ model: "Senpi Test CPU" }],
    hostname: () => hostname,
    platform: () => "darwin",
    release: () => "26.3.1",
    totalmem: () => 128 * 1024 * 1024 * 1024,
    type: () => "Darwin",
  }
}

export function createEnabledEnv(agentDir: string): TelemetryEnv {
  return {
    POSTHOG_API_KEY: "test-api-key",
    SENPI_CODING_AGENT_DIR: agentDir,
  }
}

export function createTransportRecorder(): RecordedTransport {
  const messages: TelemetryCaptureMessage[] = []
  return {
    messages,
    factory: () => ({
      capture(message) {
        messages.push(message)
      },
      flush: async () => undefined,
      shutdown: async () => undefined,
    }),
  }
}

export function createSilentLogger(): ComponentLogger {
  return {
    info() {
      return
    },
    warn() {
      return
    },
    error() {
      return
    },
  }
}

export function createRejectingTransportRecorder(messages: TelemetryCaptureMessage[]): TelemetryTransportFactory {
  return () => ({
    capture(message) {
      messages.push(message)
    },
    flush: async () => {
      throw new Error("flush failed")
    },
    shutdown: async () => undefined,
  })
}

export function createHangingTransportRecorder(messages: TelemetryCaptureMessage[]): TelemetryTransportFactory {
  return () => ({
    capture(message) {
      messages.push(message)
    },
    flush: () => new Promise<void>(() => undefined),
    shutdown: async () => undefined,
  })
}

function createTempAgentDir(): string {
  return mkdtempSync(join(tmpdir(), "omo-senpi-telemetry-test-"))
}

export function readStamp(stateDir: string): unknown {
  return JSON.parse(readFileSync(getTelemetryActivityStateFilePath(stateDir), "utf-8"))
}

export async function withTempAgentDir<T>(run: (agentDir: string) => Promise<T>): Promise<T> {
  const agentDir = createTempAgentDir()
  try {
    return await run(agentDir)
  } finally {
    rmSync(agentDir, { recursive: true, force: true })
  }
}
