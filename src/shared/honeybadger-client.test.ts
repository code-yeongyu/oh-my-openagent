import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import Honeybadger from "@honeybadger-io/js"

import {
  captureHoneybadgerError,
  initHoneybadger,
  resetHoneybadgerStateForTest,
} from "./honeybadger-client"
import { setSentryModuleForTest } from "./sentry-client"

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  resetHoneybadgerStateForTest()
})

describe("honeybadger-client", () => {
  test("does not notify in test by default", async () => {
    //#given
    process.env.NODE_ENV = "test"
    const notifySpy = spyOn(Honeybadger, "notify").mockImplementation(() => true)

    //#when
    initHoneybadger({ component: "omo-runtime", surface: "omo-plugin", runtime: "bun" })
    await captureHoneybadgerError(new Error("boom"), { action: "plugin.startup" })

    //#then
    expect(notifySpy).not.toHaveBeenCalled()
  })

  test("sanitizes sensitive context before reporting", async () => {
    //#given
    process.env.HONEYBADGER_REPORT_DATA = "1"
    const notifyAsyncSpy = spyOn(Honeybadger, "notifyAsync").mockImplementation(
      mock(async () => {}),
    )
    let capturedSentryOptions:
      | {
          tags: Record<string, string>
          contexts: { telemetry: Record<string, unknown> }
        }
      | undefined
    const sentryCaptureSpy = mock((...args: [unknown, unknown?]) => {
      const options = args[1]
      capturedSentryOptions = options as {
        tags: Record<string, string>
        contexts: { telemetry: Record<string, unknown> }
      }
      return "evt_1"
    })
    const sentryFlushSpy = mock(async () => true)
    setSentryModuleForTest({
      init: mock(() => undefined),
      captureException: sentryCaptureSpy,
      flush: sentryFlushSpy,
    })

    //#when
    initHoneybadger({ component: "omo-runtime", surface: "omo-plugin", runtime: "bun" })
    await captureHoneybadgerError(new Error("boom"), {
      action: "plugin.startup",
      awaitDelivery: true,
      context: {
        token: "secret-token",
        directory: "/work/ock-omo-system/oh-my-openagent",
      },
    })

    //#then
    const notice = notifyAsyncSpy.mock.calls[0]?.[1] as {
      context: Record<string, unknown>
    }
    expect(sentryCaptureSpy).toHaveBeenCalled()
    expect(capturedSentryOptions).toBeDefined()
    const sentryContext = capturedSentryOptions as {
      tags: Record<string, string>
      contexts: { telemetry: Record<string, unknown> }
    }
    expect(notice.context.token).toBe("[REDACTED]")
    expect(notice.context.directory).toBe("oh-my-openagent")
    expect(sentryContext.tags.repo).toBe("oh-my-openagent")
    expect(sentryContext.tags.action).toBe("plugin.startup")
    expect(sentryContext.contexts.telemetry.token).toBe("[REDACTED]")
    expect(sentryContext.contexts.telemetry.directory).toBe("oh-my-openagent")
    expect(sentryFlushSpy).toHaveBeenCalled()
  })

  test("swallows notifier failures to preserve app errors", async () => {
    //#given
    process.env.HONEYBADGER_REPORT_DATA = "1"
    spyOn(Honeybadger, "notifyAsync").mockImplementation(
      mock(async () => {
        throw new Error("notify failed")
      }),
    )
    setSentryModuleForTest({
      init: mock(() => undefined),
      captureException: mock(() => "evt_1"),
      flush: mock(async () => {
        throw new Error("flush failed")
      }),
    })

    //#when + #then
    initHoneybadger({ component: "omo-runtime", surface: "omo-plugin", runtime: "bun" })
    await expect(
      captureHoneybadgerError(new Error("boom"), {
        action: "plugin.startup",
        awaitDelivery: true,
      }),
    ).resolves.toBeUndefined()
  })
})
