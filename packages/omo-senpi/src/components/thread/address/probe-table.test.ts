import { afterEach, describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "../thread-remote-fixture"
import { probeAcross } from "./probe"

// #14748: every outcome of the per-device probe for a thread id nothing lists, devices b and c online beside this one.
// `crowded` devices answer only a lookup that is the one in flight (as a loaded device does); `silent` ones never answer.

const fixture = createRemoteThreadFixture()
afterEach(fixture.cleanup)

const THREAD = "0195f0c2-1a2b-7c3d-8e4f-00000000e001"

type Setup = {
  readonly holders?: readonly string[]
  readonly crowded?: readonly string[]
  readonly silent?: readonly string[]
}

async function probe(setup: Setup) {
  const account = fixture.account({
    wakeFeature: true,
    ended: Object.fromEntries(
      ["b", "c"].map((device): [string, Record<string, string>] => [
        device,
        setup.holders?.includes(device) === true ? { [THREAD]: `rk-${device}` } : {},
      ]),
    ),
    ...(setup.crowded === undefined ? {} : { crowdedLookups: setup.crowded }),
    ...(setup.silent === undefined ? {} : { silent: setup.silent }),
  })
  const result = await probeAcross(account.remote, THREAD, undefined, "here")
  return { result, asked: account.lookups.map((lookup) => lookup.device) }
}

describe("#14748 the per-device probe's outcome table", () => {
  test("E1: #given b holds it and answers the first round #then b's ended row, and nobody is asked again", async () => {
    const { result, asked } = await probe({ holders: ["b"], silent: ["c"] })
    expect(result).toMatchObject({ kind: "ok", resolution: "probe", entry: { transport: { row: { device: "b" } } } })
    expect(asked.sort()).toEqual(["b", "c"])
  })

  test("E3: #given b and c both hold it in the first round #then ambiguous_target naming both", async () => {
    const { result } = await probe({ holders: ["b", "c"] })
    expect(result).toMatchObject({ kind: "error", code: "ambiguous_target" })
  })

  test("E4: #given every device answers none #then not_found, and nobody is asked again", async () => {
    const { result, asked } = await probe({})
    expect(result).toMatchObject({ kind: "error", code: "not_found" })
    expect(asked.sort()).toEqual(["b", "c"])
  })

  test("E6/E9: #given b holds it, b and c both crowded #then the retries find it on b", async () => {
    const { result } = await probe({ holders: ["b"], crowded: ["b", "c"] })
    expect(result).toMatchObject({ kind: "ok", resolution: "probe", entry: { transport: { row: { device: "b" } } } })
  })

  test("E7: #given c never answers #then device_unanswered names c with the reason of its retry", async () => {
    const { result, asked } = await probe({ silent: ["c"] })
    expect(result).toMatchObject({
      kind: "error",
      code: "host_unavailable",
      details: { reason: "device_unanswered", devices: ["c"], device_reasons: { c: "host_not_answering" } },
    })
    expect(asked.filter((device) => device === "c")).toHaveLength(2)
  })

  test("E10: #given b and c both hold it, both crowded #then the retries find both: ambiguous_target", async () => {
    const { result } = await probe({ holders: ["b", "c"], crowded: ["b", "c"] })
    expect(result).toMatchObject({ kind: "error", code: "ambiguous_target" })
  })

  test("E11: #given nobody holds it, b and c both crowded #then the retries answer none: not_found, never host_unavailable", async () => {
    const { result } = await probe({ crowded: ["b", "c"] })
    expect(result).toMatchObject({ kind: "error", code: "not_found" })
  })
})
