// Security/architecture contract (omo#13440): the verbs that may run without the engine-trust stage are listed
// explicitly, and every verb the CLI dispatches is classified exactly once, so a new verb cannot slip into the
// local-only list by default or be left unclassified.
import { describe, expect, test } from "bun:test"
import { LOCAL_ONLY_REMOTE_VERBS, NETWORK_REMOTE_VERBS, VERBS } from "../remote-verbs"

describe("omo remote verb classification", () => {
  test("#given the dispatched verbs #when partitioned #then every verb is local-only or network, never both", () => {
    // given
    const local = new Set<string>(LOCAL_ONLY_REMOTE_VERBS)
    const network = new Set<string>(NETWORK_REMOTE_VERBS)

    // when
    const overlap = [...local].filter((verb) => network.has(verb))
    const unclassified = VERBS.filter((verb) => !local.has(verb) && !network.has(verb))
    const unknown = [...local, ...network].filter((verb) => !(VERBS as readonly string[]).includes(verb))

    // then
    expect(overlap).toEqual([])
    expect(unclassified).toEqual([])
    expect(unknown).toEqual([])
  })
})
