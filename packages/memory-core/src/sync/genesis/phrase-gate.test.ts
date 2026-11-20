import { expect, test } from "bun:test"
import type { AccountHttp } from "../account/http.ts"
import { boundedServiceFloor, type PhraseGate, phraseKeyBlockersOf } from "./phrase-gate.ts"

const chain = {} as AccountHttp

const gateWith = (serviceFloor: PhraseGate["serviceFloor"]): PhraseGate => ({
  enabled: true,
  serviceFloor,
  floorTimeoutMs: 5,
  refused: () => undefined,
})

test("#given a blocker label carrying bidi overrides, isolates and zero-width characters #when it is decoded #then none of them reach the label (review L3)", () => {
  const [row] = phraseKeyBlockersOf([
    {
      label: "\u202eevil\u202c \u2066box\u2069\u200b\u200d\ufeff\u2060 mac",
      kind: "cli\u200f",
      platform: "\u061clinux",
    },
  ])
  expect(row).toEqual({ label: "evil box mac", kind: "cli", platform: "linux", lastSyncAt: "" })
})

test("#given a label whose cap falls inside a surrogate pair #when it is decoded #then the cap counts code points and never leaves half a pair (review L3)", () => {
  const [row] = phraseKeyBlockersOf([{ label: `${"a".repeat(119)}\u{1f600}tail` }])
  expect(row?.label).toBe(`${"a".repeat(119)}\u{1f600}`)
  expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(row?.label ?? "")).toBe(false)
})

test("#given a floor port that never answers #when the bounded floor is read #then it is unknown within the gate's timeout (review L4)", async () => {
  expect(
    await boundedServiceFloor(
      gateWith(() => new Promise(() => {})),
      chain,
    ),
  ).toBe("unknown")
})

test("#given a floor port answering a malformed shape #when the bounded floor is read #then it is unknown, and an empty blocker list is off (review L4)", async () => {
  const bogus = gateWith(async () => "yes" as unknown as "on")
  expect(await boundedServiceFloor(bogus, chain)).toBe("unknown")
  expect(
    await boundedServiceFloor(
      gateWith(async () => ({ blockedBy: [] })),
      chain,
    ),
  ).toBe("off")
  expect(
    await boundedServiceFloor(
      gateWith(async () => "on"),
      chain,
    ),
  ).toBe("on")
})
