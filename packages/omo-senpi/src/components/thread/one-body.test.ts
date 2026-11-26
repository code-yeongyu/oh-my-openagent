import { afterEach, describe, expect, spyOn, test } from "bun:test"

import { defaultWorld, PEER, SESSION_ID } from "../../../../device-service-core/test/local-api/conformance/world.ts"
import { handleOf } from "../remote/seams"
import { clientOn, closeClients, fakeClock, startOwner } from "../remote/testing/fake-service"
import * as addressResolve from "./address/resolve"

// The remote module's session members that hold their own logic instead of the thread core's body for their call. A member
// pinned in OWN_LOGIC is reported and not moved; slice T1r (issue 15056) moves it. The pin is keyed by member name and
// only shrinks: the test fails when a member not pinned holds its own logic (the list grew), when a pinned member now
// reaches its body (the entry no longer applies: delete it and lower OWN_LOGIC_CEILING), and when the pin holds more
// entries than the ceiling.
const T1R = "#15056 (slice T1r)"
type OwnLogic = { readonly holds: string; readonly owner: string }
const OWN_LOGIC: Readonly<Record<string, OwnLogic>> = {
  "remote resolve": {
    holds:
      "remote/resolve.ts resolveMember: its own ladder over the listing rows and the alias registry, not the core resolver (thread/address/resolve.ts resolveAddress)",
    owner: T1R,
  },
}
/** The pin's size when it was ruled shrink-only; lower it as entries leave, never raise it. */
const OWN_LOGIC_CEILING = 1

function pinProblems(own: readonly string[], pin: Readonly<Record<string, OwnLogic>>): string[] {
  const pinned = Object.keys(pin)
  return [
    ...own.filter((name) => !pinned.includes(name)).map((name) => `${name}: holds its own logic and is not pinned`),
    ...pinned
      .filter((name) => !own.includes(name))
      .map((name) => `${name}: reaches its thread body now; the entry no longer applies`),
    ...(pinned.length > OWN_LOGIC_CEILING
      ? [`the pin holds ${pinned.length} entries, above ${OWN_LOGIC_CEILING}`]
      : []),
    ...pinned.filter((name) => pin[name]?.owner !== T1R).map((name) => `${name}: owner is not ${T1R}`),
  ].toSorted()
}

describe("the remote module's session members that hold their own logic (issue 15056)", () => {
  afterEach(async () => {
    await closeClients()
  })

  test("#given each resolution member #when it runs #then it reaches the core resolver unless OWN_LOGIC names it", async () => {
    const owner = await startOwner(defaultWorld())
    const client = clientOn(owner.stateDir, fakeClock())
    const resolver = spyOn(addressResolve, "resolveAddress")
    const members: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
      ["remote resolve", () => client.sessions.resolve(handleOf(PEER, SESSION_ID))],
    ]
    const own: string[] = []
    try {
      for (const [name, run] of members) {
        resolver.mockClear()
        expect({ name, kind: Reflect.get(Object(await run()), "kind") }).toEqual({ name, kind: "ok" })
        if (resolver.mock.calls.length === 0) own.push(name)
      }
    } finally {
      resolver.mockRestore()
    }
    expect(pinProblems(own, OWN_LOGIC)).toEqual([])
  })

  test("#given the pin #when a member joins the own-logic list or a pinned one reaches its body #then the pin fails, naming it", () => {
    const own = Object.keys(OWN_LOGIC)
    expect(pinProblems([...own, "remote locate"], OWN_LOGIC)).toEqual([
      "remote locate: holds its own logic and is not pinned",
    ])
    expect(pinProblems([], OWN_LOGIC)).toEqual([
      "remote resolve: reaches its thread body now; the entry no longer applies",
    ])
    const grown = { ...OWN_LOGIC, "remote locate": { holds: "its own probe", owner: T1R } }
    expect(pinProblems([...own, "remote locate"], grown)).toEqual([
      `the pin holds ${OWN_LOGIC_CEILING + 1} entries, above ${OWN_LOGIC_CEILING}`,
    ])
  })
})
