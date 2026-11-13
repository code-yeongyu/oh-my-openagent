// SP-W readers that can see "nothing": libei helpers, the second ConnectToEIS, KWin activation, the AT-SPI registry
// and the KWin global list. Each one answers yes or no only from a reading; seeing nothing is UNMEASURED (null).
import { describe, expect, test } from "bun:test"
import {
  activateAnswer,
  eisDevices,
  pwmAnswer,
  regionsAnswer,
  registryAnswer,
  secondConnectAnswer,
} from "./verdicts.ts"

const abs = (regions: { x: number; y: number; w: number; h: number }[]) => ({ event: "device", abs: 1, regions })
const kbd = { event: "device", abs: 0, kbd: 1, regions: [] }
const R1 = { x: 0, y: 0, w: 1280, h: 800 }
const R2 = { x: 1280, y: 0, w: 1024, h: 768 }

describe("libei helper reading", () => {
  test("connected, devices announced, window completed: the devices", () =>
    expect(eisDevices([{ event: "connect" }, abs([R1]), kbd, { event: "timeout" }])).toHaveLength(2))
  test("never connected is no reading", () => expect(eisDevices([abs([R1]), { event: "timeout" }])).toBeNull())
  test("helper died before its window ended (no timeout event) is no reading", () =>
    expect(eisDevices([{ event: "connect" }, abs([R1])])).toBeNull())
  test("compositor disconnected the helper is no reading of devices", () =>
    expect(eisDevices([{ event: "connect" }, abs([R1]), { event: "disconnect" }, { event: "timeout" }])).toBeNull())
  test("connected but no device at all is no reading", () =>
    expect(eisDevices([{ event: "connect" }, { event: "timeout" }])).toBeNull())
  test("empty helper output is no reading", () => expect(eisDevices([])).toBeNull())
})

describe("region answers", () => {
  const outs = ["0,0,1280x800", "1280,0,1024x768"]
  test("with a stream: yes only when every output has a region", () => {
    expect(regionsAnswer(true, outs, [abs([R1, R2])])).toBe(true)
    expect(regionsAnswer(true, outs, [abs([R1])])).toBe(false)
  })
  test("no stream: an absolute device with a region is yes, one without is no", () => {
    expect(regionsAnswer(false, outs, [abs([R1])])).toBe(true)
    expect(regionsAnswer(false, outs, [abs([])])).toBe(false)
  })
  test("devices but no absolute pointer is a reading: no", () => expect(regionsAnswer(false, outs, [kbd])).toBe(false))
  test("no helper reading or no output rectangles is UNMEASURED", () => {
    expect(regionsAnswer(true, outs, null)).toBeNull()
    expect(regionsAnswer(true, [], [abs([R1])])).toBeNull()
  })
})

describe("second ConnectToEIS", () => {
  const done = [{ event: "connect" }, kbd, { event: "timeout" }]
  test("the portal refused the second call: no", () =>
    expect(secondConnectAnswer("ok", "error:Session is already connected", [])).toBe(false))
  test("second socket connected and stayed for its window: yes", () =>
    expect(secondConnectAnswer("ok", "ok", done)).toBe(true))
  test("second socket was dropped by the compositor: no", () =>
    expect(secondConnectAnswer("ok", "ok", [{ event: "connect" }, { event: "disconnect" }])).toBe(false))
  test("second call ok but its helper reported nothing: UNMEASURED", () => {
    expect(secondConnectAnswer("ok", "ok", [])).toBeNull()
    expect(secondConnectAnswer("ok", "ok", [{ event: "timeout" }])).toBeNull()
  })
  test("first connect failed or second never attempted: UNMEASURED", () => {
    expect(secondConnectAnswer("error:x", "ok", done)).toBeNull()
    expect(secondConnectAnswer("ok", undefined, [])).toBeNull()
  })
})

describe("KWin activation", () => {
  const ok = { bound: true, target_found: true, active_before: 20, active_after: 10 }
  test("the older window became active: yes; the newer one stayed: no", () => {
    expect(activateAnswer(ok, 10, 20)).toBe(true)
    expect(activateAnswer({ ...ok, active_after: 20 }, 10, 20)).toBe(false)
  })
  test("target window never found: UNMEASURED (no request was sent)", () =>
    expect(activateAnswer({ ...ok, target_found: false }, 10, 20)).toBeNull())
  test("no active window read after the request: UNMEASURED", () =>
    expect(activateAnswer({ ...ok, active_after: null }, 10, 20)).toBeNull())
  test("not bound, newer window not active before, or a window pid unknown: UNMEASURED", () => {
    expect(activateAnswer({ ...ok, bound: false }, 10, 20)).toBeNull()
    expect(activateAnswer({ ...ok, active_before: 10 }, 10, 20)).toBeNull()
    expect(activateAnswer(ok, 0, 20)).toBeNull()
    expect(activateAnswer({}, 10, 20)).toBeNull()
  })
})

describe("AT-SPI registry", () => {
  test("the app is listed: yes", () => expect(registryAnswer(["gnome-shell", "gedit"], ["gedit"], true)).toBe(true))
  test("listing worked, app still running, not listed: no", () =>
    expect(registryAnswer(["gnome-shell"], ["gedit"], true)).toBe(false))
  test("the app exited during the window: UNMEASURED, not 'not registered'", () =>
    expect(registryAnswer(["gnome-shell"], ["gedit"], false)).toBeNull())
  test("no listing ever succeeded: UNMEASURED", () => expect(registryAnswer(null, ["gedit"], true)).toBeNull())
})

describe("KWin global list", () => {
  const PWM = "org_kde_plasma_window_management"
  test("listed: yes; not listed: no", () => {
    expect(pwmAnswer(["wl_seat", PWM], PWM, true)).toBe(true)
    expect(pwmAnswer(["wl_seat"], PWM, true)).toBe(false)
  })
  test("wayland-info read nothing: UNMEASURED", () => expect(pwmAnswer(null, PWM, true)).toBeNull())
  test("the service cache that carries the desktop file failed to build: UNMEASURED", () =>
    expect(pwmAnswer(["wl_seat"], PWM, false)).toBeNull())
})
