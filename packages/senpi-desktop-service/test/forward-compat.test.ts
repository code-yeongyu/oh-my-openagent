import type { AuditEvent } from "@oh-my-opencode/senpi-desktop-protocol"
import { afterEach, describe, expect, it } from "vitest"
import { isExecResult } from "../src/run/engine-results"
import { runComputerCode } from "../src/run/runtime"
import { NotificationHub } from "../src/service/notifications"
import { isDesktopCapabilities, parseErrorData } from "../src/service/parse"
import { DesktopService } from "../src/service/service"
import type { DesktopSessionOpenParams } from "../src/service/session-state"
import { fakeEngineFactory, rejectionOf, type SpawnLog } from "./harness"

// Every case that spawns the fake engine waits on real child-process I/O; the guard only catches a hang.
const HANG_GUARD = { timeout: 30_000 }

// A host and an engine from different releases still talk: codes, actions and capability fields one side does not
// know are tolerated, never fatal (ErrorCode amendment 1, #11461).

const click = { action: "click", target: "101", delivery: "background", durationMs: 3 } as const

function dispatchAudit(params: unknown): { readonly events: AuditEvent[]; readonly errors: Error[] } {
  const hub = new NotificationHub()
  const events: AuditEvent[] = []
  const errors: Error[] = []
  hub.onAudit((event) => events.push(event))
  hub.onError((error) => errors.push(error))
  hub.dispatch("audit", params)
  return { events, errors }
}

describe("audit notifications from a newer engine", () => {
  it("keeps an event whose code this host does not know, as unknown", () => {
    const { events, errors } = dispatchAudit({ ...click, code: "SomeFutureCode" })
    expect({ events, errors }).toEqual({ events: [{ ...click, code: "unknown" }], errors: [] })
  })

  it("keeps an event whose action this host does not know, as unknown", () => {
    const { events, errors } = dispatchAudit({ ...click, action: "window.someFutureMethod", code: null })
    expect({ events, errors }).toEqual({ events: [{ ...click, action: "unknown", code: null }], errors: [] })
  })

  it("passes the amended codes through unchanged", () => {
    const codes = ["UserIntervened", "AxUnconfirmed", "SpaceUnsupported", "SpaceMoveDenied"]
    const seen = codes.map((code) => dispatchAudit({ ...click, code }).events[0]?.code)
    expect(seen).toEqual(codes)
  })

  it("still reports a structurally malformed event", () => {
    const { events, errors } = dispatchAudit({ ...click, durationMs: "3" })
    expect({ events: events.length, errors: errors.map((error) => error.message) }).toEqual({
      events: 0,
      errors: ['desktop engine notification "audit" is malformed'],
    })
  })
})

describe("error data from a newer engine", () => {
  it("reads an amended code as itself and an unknown code as no data", () => {
    expect(parseErrorData({ code: "UserIntervened", hint: null })).toEqual({ code: "UserIntervened", hint: null })
    expect(parseErrorData({ code: "SomeFutureCode", hint: null })).toBeNull()
  })

  it("keeps the machine-readable reason of an error", () => {
    expect(parseErrorData({ code: "InvalidCoordinateFrame", hint: null, reason: "consumed" })).toEqual({
      code: "InvalidCoordinateFrame",
      hint: null,
      reason: "consumed",
    })
  })
})

describe("capabilities across releases", () => {
  const capabilities = {
    backend: "fake",
    capture: true,
    input: true,
    ax: true,
    backgroundWindowInput: true,
    deliveryModes: ["background"],
    capturePermission: "granted",
    inputPermission: "granted",
    axPermission: "granted",
    displayCount: 1,
    focusGuard: true,
    stopPath: "global",
    screenLocked: false,
  }

  it("accepts capabilities with and without interventionWatch and displayAsleep", () => {
    const newer = { ...capabilities, interventionWatch: "on", displayAsleep: false }
    expect([isDesktopCapabilities(capabilities), isDesktopCapabilities(newer)]).toEqual([true, true])
  })

  it("rejects mistyped interventionWatch or displayAsleep", () => {
    const wrong = [
      { ...capabilities, interventionWatch: true },
      { ...capabilities, displayAsleep: "no" },
    ]
    expect(wrong.map((value) => isDesktopCapabilities(value))).toEqual([false, false])
  })
})

const openCases = {
  noFeatures: { env: {}, wire: { showCursor: true } },
  reportAndIntervention: {
    env: { FAKE_ENGINE_FEATURES: '["action-report","intervention-policy"]' },
    wire: { showCursor: true, reportMode: "object", intervention: "pause" },
  },
} as const

async function openWith(
  env: Readonly<Record<string, string>>,
  params: DesktopSessionOpenParams,
): Promise<{ readonly service: DesktopService; readonly log: SpawnLog }> {
  const log = fakeEngineFactory({ FAKE_ENGINE_DESKTOP: "1", ...env })
  const service = new DesktopService({ createChild: log.factory })
  services.push(service)
  await service.open(params)
  return { service, log }
}

function clickRun(service: DesktopService) {
  return runComputerCode(
    {
      code: `const editor = await desktop.window({ app: "Code" });
				await editor.screenshot({ silent: true });
				await editor.click(3, 4);
				return "clicked";`,
      snapshot: {
        cwd: "/work",
        sessionId: "forward-compat",
        captureMaxWidth: 1280,
        captureMaxHeight: 800,
        captureMaxBytes: 5_000_000,
        display: "all",
        readOnly: false,
        stopHotkey: "ctrl+alt+shift+escape",
        allowHostRelayOnlyStop: false,
      },
      timeoutMs: 5_000,
    },
    { service, executeTool: (name) => Promise.reject(new Error(`unexpected tool ${name}`)) },
  )
}

const services: DesktopService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()))
})

// An engine rejects session.open keys it does not know (additionalProperties false), so a newer key goes out only when
// engine.hello advertises its feature; reportMode then goes out as "object" unless the caller asked for "null".
describe("feature-gated session.open", () => {
  it(
    "sends no new key to an engine without features and still runs a click whose reply is null",
    HANG_GUARD,
    async () => {
      const { service, log } = await openWith(openCases.noFeatures.env, {
        reportMode: "object",
        intervention: "continue",
        macosKeyPriming: "on",
        trace: true,
      })

      const result = await clickRun(service)
      const open = await log.nthRequest("session.open", 1)
      const reply = await service.call("click", { target: "101", x: 3, y: 4, opts: {} })

      expect({ params: open.params, returned: result.returnValue, reply }).toEqual({
        params: openCases.noFeatures.wire,
        returned: "clicked",
        reply: null,
      })
    },
  )

  it(
    "sends the object reportMode default and the resolved intervention default when both are advertised",
    HANG_GUARD,
    async () => {
      const { service, log } = await openWith(openCases.reportAndIntervention.env, {})

      const result = await clickRun(service)
      const open = await log.nthRequest("session.open", 1)
      const reply = await service.call("click", { target: "101", x: 3, y: 4, opts: {} })

      expect({
        params: open.params,
        returned: result.returnValue,
        report: isExecResult(reply) && reply !== null,
      }).toEqual({
        params: openCases.reportAndIntervention.wire,
        returned: "clicked",
        report: true,
      })
    },
  )

  it.each([
    [{ intervention: "continue" }, "object"],
    [{ intervention: "continue", reportMode: "null" }, "null"],
  ] as const)(
    "always sends each advertised option with the caller's value or its default (%o)",
    HANG_GUARD,
    async (params, reportMode) => {
      const { log } = await openWith(
        { FAKE_ENGINE_FEATURES: '["action-report","intervention-policy","key-priming","trace"]' },
        params,
      )

      const open = await log.nthRequest("session.open", 1)

      expect(open.params).toEqual({
        showCursor: true,
        reportMode,
        intervention: "continue",
        macosKeyPriming: "off",
        trace: false,
      })
    },
  )

  it("refuses an engine whose features value is not a list of names", HANG_GUARD, async () => {
    const log = fakeEngineFactory({ FAKE_ENGINE_FEATURES: '"action-report"' })
    const service = new DesktopService({ createChild: log.factory })
    services.push(service)

    expect(await rejectionOf(service.open({}))).toHaveProperty(
      "message",
      "desktop engine sent a malformed engine.hello result",
    )
  })
})

describe("exec replies", () => {
  it("fails a run whose click reply is neither null nor an ActionReport", HANG_GUARD, async () => {
    const malformedDisposition = {
      disposition: { delivery: "not_delivered", retry: "unsafe" },
      effect: "unverifiable",
      focusRestoration: "not_needed",
      auditIds: ["a"],
    }
    const { service } = await openWith({ FAKE_ENGINE_EXEC_REPLY: JSON.stringify(malformedDisposition) }, {})

    expect(await rejectionOf(clickRun(service))).toHaveProperty(
      "message",
      "desktop engine sent a malformed click result",
    )
  })
})
