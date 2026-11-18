import { describe, expect, test } from "bun:test"

import { judgeTeardown, type TeardownFacts } from "./teardown-check.ts"

const clean: TeardownFacts = {
  user: "runner",
  xorg: { code: 1, out: "" },
  inputDevices: 'I: Bus=0011\nN: Name="AT Translated Set 2 keyboard"\n',
  x11Sockets: [],
  xLocks: [".X0-lock"],
  probeWorkdirs: [],
  acl: { code: 0, out: "# file: /dev/uinput\nuser::rw-\ngroup::---\nmask::rw-\nother::---\n" },
}

describe("job teardown receipts", () => {
  test("a clean runner passes with one receipt per thing the probe creates", () => {
    expect(judgeTeardown(clean)).toEqual({
      lines: [
        "Xorg procs 0",
        "uinput devices REMOVED",
        "X sockets REMOVED (displays :90-:99)",
        "X locks REMOVED (displays :90-:99)",
        "probe workdirs REMOVED (omo-xorg-uinput-*)",
        "uinput ACL REMOVED runner",
      ],
      ok: true,
    })
  })

  test("an ACL that could not be read fails as UNREAD, never as REMOVED", () => {
    const result = judgeTeardown({ ...clean, acl: { code: 1, out: "" } })
    expect(result.ok).toBe(false)
    expect(result.lines).toContain("uinput ACL UNREAD runner: getfacl exit 1")
  })

  test("a grant still on the device fails as LEFT; the owner entry is not a grant", () => {
    const result = judgeTeardown({
      ...clean,
      acl: { code: 0, out: `${clean.acl === "no-device" ? "" : clean.acl.out}user:runner:rw-\n` },
    })
    expect(result.ok).toBe(false)
    expect(result.lines).toContain("uinput ACL LEFT runner")
  })

  test("only the probe's displays :90-:99 count; another X socket on the runner does not", () => {
    expect(judgeTeardown({ ...clean, x11Sockets: ["X0", "X1", "X100"] }).ok).toBe(true)
    const left = judgeTeardown({ ...clean, x11Sockets: ["X0", "X91"] })
    expect(left.ok).toBe(false)
    expect(left.lines).toContain("X sockets LEFT X91")
  })

  test("a leftover Xorg process or probe keyboard fails", () => {
    expect(judgeTeardown({ ...clean, xorg: { code: 0, out: "4242 Xorg :93 -config /w/xorg.conf\n" } }).lines).toContain(
      "Xorg LEFT 4242",
    )
    expect(judgeTeardown({ ...clean, inputDevices: 'N: Name="omo-qa-vkbd-1-0"\n' }).ok).toBe(false)
  })

  test("a pgrep that errors fails as UNREAD, never as no Xorg left", () => {
    const result = judgeTeardown({ ...clean, xorg: { code: 2, out: "" } })
    expect(result.ok).toBe(false)
    expect(result.lines).toContain("Xorg UNREAD: pgrep exit 2")
  })

  test("only an Xorg on the probe's displays :90-:99 counts; a machine's own Xorg does not", () => {
    const own = judgeTeardown({ ...clean, xorg: { code: 0, out: "1001 /usr/lib/xorg/Xorg :0 -nolisten tcp vt7\n" } })
    expect(own.ok).toBe(true)
    expect(own.lines).toContain("Xorg procs 0")
    const mixed = judgeTeardown({
      ...clean,
      xorg: { code: 0, out: "1001 /usr/lib/xorg/Xorg :0 vt7\n4242 Xorg :93 -config /w/xorg.conf\n" },
    })
    expect(mixed.ok).toBe(false)
    expect(mixed.lines).toContain("Xorg LEFT 4242")
  })

  test("a probe workdir left in the runner temp dir fails; another folder there does not", () => {
    expect(judgeTeardown({ ...clean, probeWorkdirs: [] }).ok).toBe(true)
    const left = judgeTeardown({ ...clean, probeWorkdirs: ["omo-xorg-uinput-AbC123"] })
    expect(left.ok).toBe(false)
    expect(left.lines).toContain("probe workdirs LEFT omo-xorg-uinput-AbC123")
  })

  test("a probe display lock left without its socket fails; another display's lock does not", () => {
    const left = judgeTeardown({ ...clean, xLocks: [".X0-lock", ".X93-lock"] })
    expect(left.ok).toBe(false)
    expect(left.lines).toContain("X locks LEFT .X93-lock")
  })
})
