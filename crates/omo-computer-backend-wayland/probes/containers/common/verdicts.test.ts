// SP-W answer rules: an answer (yes or no) comes only from a reading that could have come out the other way.
// Every reader failure (crash, timeout, missing key, failed call) is UNMEASURED, never CONFIRMS or CONTRADICTS.
import { describe, expect, test } from "bun:test"
import {
  appsFrom,
  gsAnswer,
  gsettingsBool,
  parseGlobals,
  presence,
  releaseVerdict,
  restoreAnswer,
  shiftedAtRead,
} from "./verdicts.ts"

const LIST = ["org.freedesktop.DBus.Properties", "org.freedesktop.portal.ScreenCast"]
// the records a crashed, killed or broken portal client leaves behind
const BROKEN: Record<string, Record<string, unknown>> = {
  "empty record (client printed nothing: crash, 90 s SIGKILL, gi import error)": {},
  "missing key (no version, no absent, no error)": {
    iface: "org.freedesktop.portal.GlobalShortcuts",
    interfaces_enumerated: 2,
  },
  "version key present but null": { iface: "org.freedesktop.portal.GlobalShortcuts", version: null },
}

describe("presence of a portal interface (iface record)", () => {
  test("present: the version was read", () => {
    expect(presence({ iface: "org.freedesktop.portal.X", version: 2, interfaces: LIST }, "iface")).toBeNull()
  })
  test("absent only from an enumerated list, and marked as a precondition", () => {
    const a = presence(
      { iface: "org.freedesktop.portal.X", absent: true, interfaces: LIST, interfaces_enumerated: 2 },
      "iface",
    )
    expect(a?.answer).toBe(false)
    expect(a?.observed).toContain("enumerated 2 interfaces")
    expect(a?.precondition).toBe("org.freedesktop.portal.X")
  })
  test("a call error is UNMEASURED with the error text", () => {
    const a = presence({ iface: "org.freedesktop.portal.X", error: "GDBus.Error: timeout" }, "iface")
    expect(a?.answer).toBeNull()
    expect(a?.observed).toContain("call errored: GDBus.Error: timeout")
  })
  for (const [name, rec] of Object.entries(BROKEN)) {
    test(`${name} is UNMEASURED`, () => expect(presence(rec, "iface")?.answer).toBeNull())
  }
})

describe("presence of a portal interface (session record)", () => {
  test("present", () =>
    expect(presence({ iface_name: "org.freedesktop.portal.RemoteDesktop", iface_version: 2 }, "session")).toBeNull())
  test("absent is a precondition", () => {
    const a = presence(
      { iface_name: "org.freedesktop.portal.RemoteDesktop", result: "interface_absent", interfaces_enumerated: 12 },
      "session",
    )
    expect(a?.answer).toBe(false)
    expect(a?.precondition).toBe("org.freedesktop.portal.RemoteDesktop")
  })
  test("interface_error is UNMEASURED", () =>
    expect(presence({ iface_name: "x", result: "interface_error", iface_error: "boom" }, "session")?.answer).toBeNull())
  test("empty record is UNMEASURED", () => expect(presence({}, "session")?.answer).toBeNull())
})

describe("GlobalShortcuts answer", () => {
  test("CONFIRMS only with a version", () =>
    expect(gsAnswer({ iface: "g", version: 1, interfaces: LIST }).answer).toBe(true))
  test("absent is a plain no (the portal IS the question): no precondition mark", () => {
    const a = gsAnswer({ iface: "g", absent: true, interfaces: LIST, interfaces_enumerated: 2 })
    expect(a.answer).toBe(false)
    expect(a.precondition).toBeUndefined()
  })
  test("crash record is UNMEASURED", () => expect(gsAnswer({ error: "Traceback" }).answer).toBeNull())
  for (const [name, rec] of Object.entries(BROKEN)) {
    test(`${name} is UNMEASURED`, () => expect(gsAnswer(rec).answer).toBeNull())
  }
})

describe("restore leg", () => {
  const present = { iface_name: "p", iface_version: 2 }
  test("started with no dialog answered: the token was honoured", () =>
    expect(restoreAnswer({ ...present, result: "started", start_code: 0 })).toBe(true))
  test("timeout: a dialog waited, the token was not honoured", () =>
    expect(restoreAnswer({ ...present, result: "timeout", start_code: null })).toBe(false))
  test("a backend error code is UNMEASURED", () =>
    expect(restoreAnswer({ ...present, result: "code_2", start_code: 2 })).toBeNull())
  test("a crashed restore leg is UNMEASURED, not a refused token", () => expect(restoreAnswer({})).toBeNull())
})

describe("readers that fail never produce a negative", () => {
  test("wayland-info output parses to globals", () =>
    expect(parseGlobals("interface: 'wl_shm', version: 2\ninterface: 'wl_seat', version: 9", 0)).toEqual([
      "wl_shm",
      "wl_seat",
    ]))
  test("wayland-info exit != 0 is no reading", () => expect(parseGlobals("interface: 'wl_shm'", 1)).toBeNull())
  test("wayland-info printing no global is no reading", () =>
    expect(parseGlobals("failed to create display", 0)).toBeNull())
  test("gsettings true/false parse", () => {
    expect(gsettingsBool("true\n", 0)).toBe(true)
    expect(gsettingsBool("false\n", 0)).toBe(false)
  })
  test("gsettings failure or garbage is no reading", () => {
    expect(gsettingsBool("", 1)).toBeNull()
    expect(gsettingsBool("No such schema", 0)).toBeNull()
  })
  test("an AT-SPI listing with apps is a reading", () =>
    expect(appsFrom('{"apps": ["gnome-shell"]}', 0)).toEqual(["gnome-shell"]))
  test("an empty, failed or missing AT-SPI listing is no reading", () => {
    expect(appsFrom('{"apps": []}', 0)).toBeNull()
    expect(appsFrom("", 1)).toBeNull()
    expect(appsFrom("Traceback", 0)).toBeNull()
  })
})

describe("release read and verdict", () => {
  const T0 = 1000
  test("an unshifted a after t0 reads unshifted", () =>
    expect(
      shiftedAtRead(
        [
          { t: 1300, kind: "mods", depressed: 0 },
          { t: 1300, kind: "key", pressed: true, sym: "a" },
        ],
        T0,
      ),
    ).toBe(false))
  test("A, or shift depressed at the key, reads shifted", () => {
    expect(shiftedAtRead([{ t: 1300, kind: "key", pressed: true, sym: "A" }], T0)).toBe(true)
    expect(
      shiftedAtRead(
        [
          { t: 900, kind: "mods", depressed: 1 },
          { t: 1300, kind: "key", pressed: true, sym: "a" },
        ],
        T0,
      ),
    ).toBe(true)
  })
  test("no key after t0, or only a release, is no reading", () => {
    expect(shiftedAtRead([{ t: 900, kind: "key", pressed: true, sym: "a" }], T0)).toBeNull()
    expect(shiftedAtRead([{ t: 1300, kind: "key", pressed: false, sym: "a" }], T0)).toBeNull()
  })
  test("proven: control (holder alive) shifted, kill leg unshifted", () => {
    const v = releaseVerdict(true, false)
    expect([v.answer, v.state]).toEqual([true, "proven"])
  })
  test("contradicted: control shifted, kill leg still shifted", () => {
    const v = releaseVerdict(true, true)
    expect([v.answer, v.state]).toEqual([false, "contradicted"])
  })
  test("a control that does not show shift means the method cannot discriminate", () => {
    for (const kill of [true, false, null]) {
      const v = releaseVerdict(false, kill)
      expect([v.answer, v.state]).toEqual([null, "unproven"])
      expect(v.reason).toContain("cannot discriminate")
    }
  })
  test("a missing control or kill reading is unproven", () => {
    expect(releaseVerdict(null, false).state).toBe("unproven")
    expect(releaseVerdict(true, null).state).toBe("unproven")
  })
})
