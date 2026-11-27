import { describe, expect, test } from "bun:test"

import { withColdWake, withoutColdWake } from "../../src/cold-wake/service-table.ts"
import { environmentAssignments, serviceTableOf } from "../../src/cold-wake/linux.ts"

// omo#13594: the device service reads OMO_RELAYD_SERVICES once at start and starts only the entry named "omo" for a cold
// wake. omo owns that one entry: it adds or removes it, keeps every other entry, and never rewrites a table it cannot read.

const LINUX_ENTRY = { systemd_user: "omo-session-host.service", senders: [] }
const DARWIN_ENTRY = { launchd: "ai.omo.session-host", senders: [] }
const WEB = { web: { systemd_user: "web.service", senders: ["dev-a"] } }

describe("adding the cold-wake entry", () => {
  test("to no table writes a table with only the entry, per platform", () => {
    expect(withColdWake(undefined, "linux")).toEqual({ kind: "changed", value: JSON.stringify({ omo: LINUX_ENTRY }) })
    expect(withColdWake("", "darwin")).toEqual({ kind: "changed", value: JSON.stringify({ omo: DARWIN_ENTRY }) })
  })

  test("keeps the owner's other entries", () => {
    const edit = withColdWake(JSON.stringify(WEB), "linux")
    expect(edit.kind === "changed" ? JSON.parse(edit.value ?? "") : edit).toEqual({ ...WEB, omo: LINUX_ENTRY })
  })

  test("is unchanged when the entry is already there, so nothing is rewritten or restarted", () => {
    expect(withColdWake(JSON.stringify({ ...WEB, omo: LINUX_ENTRY }), "linux")).toEqual({ kind: "unchanged" })
  })

  test("replaces an entry that names another unit or admits senders", () => {
    const stale = JSON.stringify({ omo: { systemd_user: "other.service", senders: ["dev-a"] } })
    expect(withColdWake(stale, "linux")).toEqual({ kind: "changed", value: JSON.stringify({ omo: LINUX_ENTRY }) })
  })

  test.each([["not json"], ["[1]"], ['"text"']])("refuses an unreadable table %p instead of overwriting it", (raw) => {
    expect(withColdWake(raw, "linux").kind).toBe("invalid")
  })
})

describe("removing the cold-wake entry", () => {
  test("keeps the other entries", () => {
    expect(withoutColdWake(JSON.stringify({ ...WEB, omo: LINUX_ENTRY }))).toEqual({
      kind: "changed",
      value: JSON.stringify(WEB),
    })
  })

  test("leaves no table when the entry was the only one", () => {
    expect(withoutColdWake(JSON.stringify({ omo: DARWIN_ENTRY }))).toEqual({ kind: "changed", value: undefined })
  })

  test("is unchanged with no entry or no table", () => {
    expect(withoutColdWake(JSON.stringify(WEB))).toEqual({ kind: "unchanged" })
    expect(withoutColdWake(undefined)).toEqual({ kind: "unchanged" })
  })
})

describe("reading the table from systemctl show -p Environment --value", () => {
  // Captured from systemd 255: plain assignments bare, others double-quoted with C escapes.
  const SHOWN = String.raw`LANG=C "OMO_RELAYD_SERVICES={\"web\":{\"systemd_user\":\"web.service\",\"senders\":[]},\"x y\":1}" OMO_RELAY=wss://relay.example`

  test("splits the assignments, unquoting and unescaping each", () => {
    expect(environmentAssignments(SHOWN)).toEqual([
      "LANG=C",
      'OMO_RELAYD_SERVICES={"web":{"systemd_user":"web.service","senders":[]},"x y":1}',
      "OMO_RELAY=wss://relay.example",
    ])
  })

  test("takes the last assignment of the table, as systemd does", () => {
    expect(serviceTableOf(`${SHOWN} OMO_RELAYD_SERVICES={}`)).toBe("{}")
    expect(serviceTableOf("LANG=C")).toBeUndefined()
    expect(serviceTableOf("")).toBeUndefined()
  })
})
