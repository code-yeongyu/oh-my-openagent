/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CodexInstallSandbox } from "../../scripts/install-test-fixtures.d.mts"
import { createCodexInstallSandbox, disposeCodexInstallSandboxes } from "../../scripts/install-test-fixtures.mjs"
import * as codexPostHog from "../telemetry/posthog"
import { trackCodexInstallTelemetry } from "./codex-install-telemetry"

// #13253: install telemetry resolved its opt-out and its state directory from process.env, so an installer given a
// sandbox env still wrote install-id and the daily claim under the process's data home and could send an install
// event. The env the installer is given must decide both.
const processDataHome = mkdtempSync(join(tmpdir(), "omo-codex-telemetry-process-data-"))
const originalDataHome = process.env.XDG_DATA_HOME

function recordCaptures(): string[] {
  const captures: string[] = []
  codexPostHog.__setTransportFactoryForTesting(() => ({
    capture: (event: { readonly event: string }) => {
      captures.push(event.event)
    },
    shutdown: async () => undefined,
  }))
  return captures
}

afterEach(() => {
  codexPostHog.__resetTransportFactoryForTesting()
  disposeCodexInstallSandboxes()
  if (originalDataHome === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = originalDataHome
  rmSync(processDataHome, { recursive: true, force: true })
})

describe("install telemetry follows the env it is given", () => {
  test("#given an env without an opt-out #when install telemetry runs #then its state lands in that env's data home, not the process's", async () => {
    // given: the bun preload opts this process out (OMO_DISABLE_POSTHOG) and points its data home elsewhere
    const sandbox: CodexInstallSandbox = createCodexInstallSandbox("telemetry")
    const { DO_NOT_TRACK: _optOut, ...env } = sandbox.env
    process.env.XDG_DATA_HOME = processDataHome
    const captures = recordCaptures()

    // when
    await trackCodexInstallTelemetry(env)

    // then
    expect(captures).toEqual(["omo_codex_daily_active"])
    expect(existsSync(join(env.XDG_DATA_HOME, "omo-codex", "install-id"))).toBe(true)
    expect(existsSync(processDataHome) ? readdirSync(processDataHome) : []).toEqual([])
  })

  test("#given the sandbox env #when install telemetry runs #then nothing is captured and nothing is written", async () => {
    const sandbox: CodexInstallSandbox = createCodexInstallSandbox("telemetry")
    process.env.XDG_DATA_HOME = processDataHome
    const captures = recordCaptures()

    await trackCodexInstallTelemetry(sandbox.env)

    expect(sandbox.env.DO_NOT_TRACK).toBe("1")
    expect(captures).toEqual([])
    expect(existsSync(join(sandbox.env.XDG_DATA_HOME, "omo-codex"))).toBe(false)
    expect(existsSync(processDataHome) ? readdirSync(processDataHome) : []).toEqual([])
  })
})
