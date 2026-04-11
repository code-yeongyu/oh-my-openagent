import { afterEach, describe, expect, it, mock } from "bun:test"

async function* createEmptyEventStream(): AsyncIterable<unknown> {}

describe("run telemetry isolation", () => {
  afterEach(() => {
    mock.restore()
  })

  it("does not crash CLI run when telemetry throws", async () => {
    // given
    mock.module("../../plugin-config", () => ({
      loadPluginConfig: mock(() => ({})),
    }))
    mock.module("./agent-resolver", () => ({
      resolveRunAgent: mock(() => "Sisyphus - Ultraworker"),
    }))
    mock.module("./server-connection", () => ({
      createServerConnection: mock(async () => ({
        client: {
          event: {
            subscribe: mock(async () => ({ stream: createEmptyEventStream() })),
          },
          session: {
            promptAsync: mock(async () => undefined),
          },
        },
        cleanup: mock(() => {}),
      })),
    }))
    mock.module("./session-resolver", () => ({
      resolveSession: mock(async () => "ses_test"),
    }))
    mock.module("./json-output", () => ({
      createJsonOutputManager: mock(() => ({
        redirectToStderr: mock(() => {}),
        restore: mock(() => {}),
        emitResult: mock(() => {}),
      })),
    }))
    mock.module("./on-complete-hook", () => ({
      executeOnCompleteHook: mock(async () => {}),
    }))
    mock.module("./model-resolver", () => ({
      resolveRunModel: mock(() => null),
    }))
    mock.module("./poll-for-completion", () => ({
      pollForCompletion: mock(async () => 0),
    }))
    mock.module("./agent-profile-colors", () => ({
      loadAgentProfileColors: mock(async () => ({})),
    }))
    mock.module("./stdin-suppression", () => ({
      suppressRunInput: mock(() => mock(() => {})),
    }))
    mock.module("./timestamp-output", () => ({
      createTimestampedStdoutController: mock(() => ({
        enable: mock(() => {}),
        restore: mock(() => {}),
      })),
    }))
    mock.module("../../shared/posthog", () => ({
      createCliPostHog: mock(() => ({
        trackActive: () => {
          throw new Error("telemetry failed")
        },
        capture: mock(() => {}),
        captureException: mock(() => {}),
        shutdown: mock(async () => {
          throw new Error("shutdown failed")
        }),
      })),
      getPostHogDistinctId: mock(() => "run-distinct-id"),
    }))

    const { run } = await import(`./runner?telemetry=${Date.now()}-${Math.random()}`)

    // when
    const result = await run({ message: "test" })

    // then
    expect(result).toBe(0)
  })
})
