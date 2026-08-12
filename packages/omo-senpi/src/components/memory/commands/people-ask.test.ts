import { describe, expect, test } from "bun:test"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import { fakeCommandContext, fakeDeps, invoke } from "./commands.test-support"
import { registerPeopleCommand } from "./people"
import { hasNoEvidence, type PeopleAskEvidence, type PeopleAskRequest } from "./people-ask"
import { peopleFixture } from "./people.test-support"

describe("/people --ask", () => {
  test("#given no evidence for the person #when --ask runs #then it abstains without launching a child", async () => {
    // given
    const identity = await peopleFixture()
    const asked: PeopleAskRequest[] = []
    const pi = new MemoryFakeExtensionAPI()
    registerPeopleCommand(
      pi,
      fakeDeps(identity, {
        peopleAsk: (request) => {
          asked.push(request)
          return Promise.resolve("never reached")
        },
      }),
    )
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "people", 'nia-blank --ask "does nia ship on fridays?"', ctx)

    // then
    expect(hasNoEvidence({ card: [], observations: [], searchHits: [] })).toBe(true)
    expect(asked).toEqual([])
    expect(ctx.ui.notifications).toEqual([{ message: text, level: "info" }])
  }, 30_000)

  test("#given card and observation evidence #when --ask runs #then the quick child receives that evidence and its answer renders", async () => {
    // given
    const identity = await peopleFixture(3)
    const asked: PeopleAskRequest[] = []
    const pi = new MemoryFakeExtensionAPI()
    registerPeopleCommand(
      pi,
      fakeDeps(identity, {
        peopleAsk: (request) => {
          asked.push(request)
          return Promise.resolve("Jane reviews small diffs.")
        },
      }),
    )
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "people", 'jane-doe --ask "how does jane review?"', ctx)

    // then
    expect(asked.length).toBe(1)
    expect(asked[0]?.question).toBe("how does jane review?")
    expect(asked[0]?.slug).toBe("jane-doe")
    const evidence = asked[0]?.evidence as PeopleAskEvidence
    expect(evidence.card).toEqual([
      "IDENTITY: staff engineer",
      "ATTRIBUTE: prefers small diffs",
      "RELATIONSHIP: reports-to: human",
    ])
    expect(evidence.observations.length).toBe(4)
    expect(hasNoEvidence(evidence)).toBe(false)
    expect(ctx.ui.notifications).toEqual([{ message: text, level: "info" }])
  }, 30_000)
})
