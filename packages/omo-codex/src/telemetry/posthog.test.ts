import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_POSTHOG_API_KEY as TELEMETRY_CORE_DEFAULT_POSTHOG_API_KEY } from "@oh-my-opencode/telemetry-core"

import { CACHE_DIR_NAME } from "./product-identity"

type CapturedPostHogMessage = {
  readonly distinctId: string
  readonly event: string
  readonly properties?: Record<string, unknown>
}

type PostHogModule = typeof import("./posthog")

async function importPostHogModule(): Promise<PostHogModule> {
  return import(`./posthog?test=${Date.now()}-${Math.random()}`)
}

const originalXdgDataHome = process.env.XDG_DATA_HOME
const tempPaths: string[] = []

function createDataHomePath(): string {
  const tempPath = mkdtempSync(join(tmpdir(), "omo-codex-posthog-"))
  mkdirSync(join(tempPath, CACHE_DIR_NAME), { recursive: true })
  tempPaths.push(tempPath)
  return tempPath
}

function clearTelemetryEnv(): void {
  delete process.env.OMO_DISABLE_POSTHOG
  delete process.env.OMO_SEND_ANONYMOUS_TELEMETRY
  delete process.env.OMO_CODEX_DISABLE_POSTHOG
  delete process.env.OMO_CODEX_SEND_ANONYMOUS_TELEMETRY
  delete process.env.POSTHOG_API_KEY
  delete process.env.POSTHOG_HOST
}

function mockPostHogNode(posthog: PostHogModule, capturedMessages: CapturedPostHogMessage[]): void {
  posthog.__setTransportFactoryForTesting(() => ({
    capture: (message: any) => {
      capturedMessages.push(message)
    },
    flush: async () => {},
    shutdown: async () => {},
  }))
}

function setMatrix(
  globalDisable: string | undefined,
  globalAnonymous: string | undefined,
  codexDisable: string | undefined,
  codexAnonymous: string | undefined,
): void {
  if (globalDisable === undefined) delete process.env.OMO_DISABLE_POSTHOG
  else process.env.OMO_DISABLE_POSTHOG = globalDisable
  if (globalAnonymous === undefined) delete process.env.OMO_SEND_ANONYMOUS_TELEMETRY
  else process.env.OMO_SEND_ANONYMOUS_TELEMETRY = globalAnonymous
  if (codexDisable === undefined) delete process.env.OMO_CODEX_DISABLE_POSTHOG
  else process.env.OMO_CODEX_DISABLE_POSTHOG = codexDisable
  if (codexAnonymous === undefined) delete process.env.OMO_CODEX_SEND_ANONYMOUS_TELEMETRY
  else process.env.OMO_CODEX_SEND_ANONYMOUS_TELEMETRY = codexAnonymous
}

describe("omo-codex posthog telemetry", () => {
  beforeEach(() => {
    mock.restore()
    clearTelemetryEnv()
    process.env.XDG_DATA_HOME = createDataHomePath()
    process.env.XDG_STATE_HOME = process.env.XDG_DATA_HOME
  })

  afterEach(() => {
    mock.restore()
    clearTelemetryEnv()
    if (originalXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome
    }
    delete process.env.XDG_STATE_HOME
    for (const tempPath of tempPaths.splice(0)) {
      rmSync(tempPath, { recursive: true, force: true })
    }
  })

  it("matrix row 1 disabled when OMO_DISABLE_POSTHOG=1", async () => {
    // given
    const capturedMessages: CapturedPostHogMessage[] = []
    process.env.POSTHOG_API_KEY = "test-api-key"
    setMatrix("1", undefined, undefined, undefined)
    const posthog = await importPostHogModule()
    mockPostHogNode(posthog, capturedMessages)
    mockPostHogNode(posthog, capturedMessages)
    posthog.__setActivityStateProviderForTesting(() => ({ dayUTC: "2026-05-25", captureDaily: true }))

    // when
    posthog.createCliPostHog().trackActive("distinct", "cli_run")

    // then
    expect(capturedMessages).toHaveLength(0)
  })

  it("matrix row 2 disabled when OMO_SEND_ANONYMOUS_TELEMETRY=0", async () => {
    // given
    const capturedMessages: CapturedPostHogMessage[] = []

    process.env.POSTHOG_API_KEY = "test-api-key"
    setMatrix(undefined, "0", undefined, undefined)
    const posthog = await importPostHogModule()
    mockPostHogNode(posthog, capturedMessages)
    posthog.__setActivityStateProviderForTesting(() => ({ dayUTC: "2026-05-25", captureDaily: true }))

    // when
    posthog.createCliPostHog().trackActive("distinct", "cli_run")

    // then
    expect(capturedMessages).toHaveLength(0)
  })

  it("matrix row 3 disabled when OMO_CODEX_DISABLE_POSTHOG=1", async () => {
    // given
    const capturedMessages: CapturedPostHogMessage[] = []

    process.env.POSTHOG_API_KEY = "test-api-key"
    setMatrix(undefined, undefined, "1", undefined)
    const posthog = await importPostHogModule()
    mockPostHogNode(posthog, capturedMessages)
    posthog.__setActivityStateProviderForTesting(() => ({ dayUTC: "2026-05-25", captureDaily: true }))

    // when
    posthog.createCliPostHog().trackActive("distinct", "cli_run")

    // then
    expect(capturedMessages).toHaveLength(0)
  })

  it("matrix row 4 disabled when OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0", async () => {
    // given
    const capturedMessages: CapturedPostHogMessage[] = []

    process.env.POSTHOG_API_KEY = "test-api-key"
    setMatrix(undefined, undefined, undefined, "0")
    const posthog = await importPostHogModule()
    mockPostHogNode(posthog, capturedMessages)
    posthog.__setActivityStateProviderForTesting(() => ({ dayUTC: "2026-05-25", captureDaily: true }))

    // when
    posthog.createCliPostHog().trackActive("distinct", "cli_run")

    // then
    expect(capturedMessages).toHaveLength(0)
  })

  it("matrix row 5 enabled when all vars unset", async () => {
    // given
    const capturedMessages: CapturedPostHogMessage[] = []

    process.env.POSTHOG_API_KEY = "test-api-key"
    setMatrix(undefined, undefined, undefined, undefined)
    const posthog = await importPostHogModule()
    mockPostHogNode(posthog, capturedMessages)
    posthog.__setActivityStateProviderForTesting(() => ({ dayUTC: "2026-05-25", captureDaily: true }))

    // when
    posthog.createCliPostHog().trackActive("distinct", "cli_run")

    // then
    expect(capturedMessages).toHaveLength(1)
  })

  it("captures omo_codex_daily_active with omo-codex platform", async () => {
    // given
    const capturedMessages: CapturedPostHogMessage[] = []

    process.env.POSTHOG_API_KEY = "test-api-key"
    const posthog = await importPostHogModule()
    mockPostHogNode(posthog, capturedMessages)
    posthog.__setActivityStateProviderForTesting(() => ({ dayUTC: "2026-05-25", captureDaily: true }))

    // when
    posthog.createCliPostHog().trackActive("distinct", "cli_run")

    // then
    expect(capturedMessages[0]?.event).toBe("omo_codex_daily_active")
    expect(capturedMessages[0]?.properties?.platform).toBe("omo-codex")
  })

  it("does not capture on same day", async () => {
    // given
    const capturedMessages: CapturedPostHogMessage[] = []

    process.env.POSTHOG_API_KEY = "test-api-key"
    const posthog = await importPostHogModule()
    mockPostHogNode(posthog, capturedMessages)
    posthog.__setActivityStateProviderForTesting(() => ({ dayUTC: "2026-05-25", captureDaily: false }))

    // when
    posthog.createCliPostHog().trackActive("distinct", "cli_run")

    // then
    expect(capturedMessages).toHaveLength(0)
  })

  it("createInstallPostHog sets source=install", async () => {
    // given
    const capturedMessages: CapturedPostHogMessage[] = []

    process.env.POSTHOG_API_KEY = "test-api-key"
    const posthog = await importPostHogModule()
    mockPostHogNode(posthog, capturedMessages)
    posthog.__setActivityStateProviderForTesting(() => ({ dayUTC: "2026-05-25", captureDaily: true }))

    // when
    posthog.createInstallPostHog().trackActive("distinct", "install_started")

    // then
    expect(capturedMessages[0]?.properties?.source).toBe("install")
  })

  it("createCliPostHog sets source=cli", async () => {
    // given
    const capturedMessages: CapturedPostHogMessage[] = []

    process.env.POSTHOG_API_KEY = "test-api-key"
    const posthog = await importPostHogModule()
    mockPostHogNode(posthog, capturedMessages)
    posthog.__setActivityStateProviderForTesting(() => ({ dayUTC: "2026-05-25", captureDaily: true }))

    // when
    posthog.createCliPostHog().trackActive("distinct", "cli_run")

    // then
    expect(capturedMessages[0]?.properties?.source).toBe("cli")
  })

  it("returns no-op when POSTHOG_API_KEY override is empty", async () => {
    // given
    const capturedMessages: CapturedPostHogMessage[] = []

    process.env.POSTHOG_API_KEY = " "
    const posthog = await importPostHogModule()
    mockPostHogNode(posthog, capturedMessages)
    posthog.__setActivityStateProviderForTesting(() => ({ dayUTC: "2026-05-25", captureDaily: true }))

    // when
    posthog.createCliPostHog().trackActive("distinct", "cli_run")

    // then
    expect(capturedMessages).toHaveLength(0)
  })

  it("uses API key exactly matching telemetry-core source bytes", async () => {
    // given
    const posthog = await importPostHogModule()
    const telemetryCoreConstants = readFileSync(
      join(import.meta.dir, "../../../../packages/telemetry-core/src/constants.ts"),
      "utf-8",
    )
    const match = telemetryCoreConstants.match(/DEFAULT_POSTHOG_API_KEY = "(phc_[a-zA-Z0-9]+)"/)

    // when
    const sourceKey = match?.[1]

    // then
    expect(sourceKey).toBe(TELEMETRY_CORE_DEFAULT_POSTHOG_API_KEY)
    expect(posthog.DEFAULT_POSTHOG_API_KEY).toBe(TELEMETRY_CORE_DEFAULT_POSTHOG_API_KEY)
  })
})
