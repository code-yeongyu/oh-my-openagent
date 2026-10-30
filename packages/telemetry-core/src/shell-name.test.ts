import { describe, expect, test } from "bun:test"

import { DEFAULT_POSTHOG_API_KEY, DEFAULT_POSTHOG_HOST, createTelemetryClient } from "./index"
import type { TelemetryCaptureMessage, TelemetryOsProvider, TelemetryProductConfig } from "./index"

const PRODUCT = {
  cacheDirName: "omo-codex",
  defaultApiKey: DEFAULT_POSTHOG_API_KEY,
  defaultHost: DEFAULT_POSTHOG_HOST,
  eventName: "omo_codex_daily_active",
  packageName: "@oh-my-opencode/omo-codex",
  packageVersion: "4.9.2",
  platform: "omo-codex",
  productName: "omo-codex",
  productEnvPrefix: "OMO_CODEX",
} satisfies TelemetryProductConfig

const OS_PROVIDER = {
  arch: () => "arm64",
  cpus: () => [{ model: "Apple M-test" }],
  hostname: () => "test-host",
  platform: () => "darwin",
  release: () => "26.0.0",
  totalmem: () => 17_179_869_184,
  type: () => "Darwin",
} satisfies TelemetryOsProvider

const USER = "alice-sentinel-7f3a"

// Every shape a login shell path takes on the platforms OmO runs on. The user's name must never leave the
// machine through the shared daily-active properties; only the shell program's name is sent.
const CASES: ReadonlyArray<{ readonly shell: string | undefined; readonly expected: string | undefined }> = [
  { shell: `/home/${USER}/.nix-profile/bin/zsh`, expected: "zsh" },
  { shell: `/Users/${USER}/.local/bin/fish`, expected: "fish" },
  { shell: "/bin/bash", expected: "bash" },
  { shell: "/usr/local/bin/nu", expected: "nu" },
  { shell: `C:\\Users\\${USER}\\scoop\\shims\\pwsh.exe`, expected: "pwsh" },
  { shell: "C:\\Windows\\System32\\cmd.exe", expected: "cmd" },
  { shell: "zsh", expected: "zsh" },
  { shell: `/home/${USER}/bin/`, expected: undefined },
  { shell: "", expected: undefined },
  { shell: undefined, expected: undefined },
]

async function captureShellProperty(shell: string | undefined): Promise<TelemetryCaptureMessage> {
  const captured: TelemetryCaptureMessage[] = []
  const previous = process.env.SHELL
  if (shell === undefined) delete process.env.SHELL
  else process.env.SHELL = shell
  try {
    const client = createTelemetryClient({
      env: { POSTHOG_API_KEY: "test-key", POSTHOG_HOST: "https://posthog.test" },
      osProvider: OS_PROVIDER,
      product: PRODUCT,
      source: "cli",
      transportFactory: () => ({
        capture: (message) => {
          captured.push(message)
        },
        flush: async () => undefined,
        shutdown: async () => undefined,
      }),
    })
    client.trackActive({ dayUTC: "2026-05-25", distinctId: "a".repeat(64), reason: "cli_run" })
    await client.flush()
    await client.shutdown()
  } finally {
    if (previous === undefined) delete process.env.SHELL
    else process.env.SHELL = previous
  }
  expect(captured).toHaveLength(1)
  return captured[0] as TelemetryCaptureMessage
}

describe("daily-active shell property", () => {
  for (const { shell, expected } of CASES) {
    test(`#given SHELL=${JSON.stringify(shell)} #when daily active is captured #then only the shell name ${JSON.stringify(expected)} is sent`, async () => {
      const message = await captureShellProperty(shell)

      expect(message.properties?.["shell"]).toBe(expected)
      expect(JSON.stringify(message)).not.toContain(USER)
    })
  }
})
