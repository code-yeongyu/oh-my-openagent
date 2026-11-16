import { describe, expect, test } from "bun:test"

import { judgeTeardown, type TeardownFacts } from "./teardown-check.ts"

const clean: TeardownFacts = {
  user: "runner",
  xorgPids: [],
  inputDevices: 'I: Bus=0011\nN: Name="AT Translated Set 2 keyboard"\n',
  x11Sockets: [],
  acl: { code: 0, out: "# file: /dev/uinput\nuser::rw-\ngroup::---\nmask::rw-\nother::---\n" },
}

describe("job teardown receipts", () => {
  test("a clean runner passes with one receipt per thing the probe creates", () => {
    expect(judgeTeardown(clean)).toEqual({
      lines: [
        "Xorg procs 0",
        "uinput devices REMOVED",
        "X sockets REMOVED (displays :90-:99)",
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
    expect(judgeTeardown({ ...clean, xorgPids: ["4242"] }).lines).toContain("Xorg LEFT 4242")
    expect(judgeTeardown({ ...clean, inputDevices: 'N: Name="omo-qa-vkbd-1-0"\n' }).ok).toBe(false)
  })
})
