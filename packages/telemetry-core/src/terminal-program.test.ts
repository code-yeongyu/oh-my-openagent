import { describe, expect, test } from "bun:test"

import { DEFAULT_POSTHOG_API_KEY, DEFAULT_POSTHOG_HOST, createTelemetryClient } from "./index"
import type { TelemetryCaptureMessage, TelemetryOsProvider, TelemetryProductConfig } from "./index"
import { KNOWN_TERMINAL_PROGRAMS } from "./terminal-program"

const SENTINEL = "/home/sentinel-user/bin/x"

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

function captureWithTermProgram(termProgram: string | undefined): TelemetryCaptureMessage {
  const saved = process.env.TERM_PROGRAM
  if (termProgram === undefined) delete process.env.TERM_PROGRAM
  else process.env.TERM_PROGRAM = termProgram
  try {
    const captured: TelemetryCaptureMessage[] = []
    const client = createTelemetryClient({
      env: { POSTHOG_API_KEY: "test-key" },
      osProvider: OS_PROVIDER,
      product: PRODUCT,
      source: "cli",
      transportFactory: () => ({
        capture: (message) => {
          captured.push(message)
        },
        shutdown: async () => undefined,
      }),
    })
    client.trackActive({ dayUTC: "2026-10-28", distinctId: "distinct", reason: "cli_run" })
    const [message] = captured
    if (message === undefined) throw new Error("expected one captured message")
    return message
  } finally {
    if (saved === undefined) delete process.env.TERM_PROGRAM
    else process.env.TERM_PROGRAM = saved
  }
}

// Privacy contract: the activity event's `terminal` is a published list value, "other", or absent.
describe("activity event terminal property", () => {
  const cases: ReadonlyArray<readonly [string, string | undefined, string | undefined]> = [
    ...KNOWN_TERMINAL_PROGRAMS.map((name) => [`known ${name}`, name, name] as const),
    ["path-shaped sentinel", SENTINEL, "other"],
    ["unknown program name", "my-private-terminal", "other"],
    ["known name in another case", "iterm.app", "other"],
    ["known name with surrounding space", " vscode ", "other"],
    ["empty value", "", undefined],
    ["unset", undefined, undefined],
  ]

  for (const [name, termProgram, expected] of cases) {
    test(`#given TERM_PROGRAM ${name} #when the activity event is captured #then terminal is ${String(expected)}`, () => {
      const message = captureWithTermProgram(termProgram)

      expect(message.properties?.["terminal"]).toBe(expected)
    })
  }

  test("#given a path-shaped TERM_PROGRAM #when the activity event is captured #then the value appears nowhere in the message", () => {
    const message = captureWithTermProgram(SENTINEL)

    expect(JSON.stringify(message)).not.toContain("sentinel-user")
  })
})
