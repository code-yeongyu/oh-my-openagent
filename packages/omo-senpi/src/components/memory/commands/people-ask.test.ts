import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { SenpiModelPort } from "@oh-my-opencode/senpi-task"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import { fakeCommandContext, fakeDeps, invoke } from "./commands.test-support"
import { registerPeopleCommand } from "./people"
import { createPeopleAskRunner, hasNoEvidence, type PeopleAskEvidence, type PeopleAskRequest } from "./people-ask"
import { peopleFixture } from "./people.test-support"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

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

  test("#given senpiCommand and senpiPrefixArgs #when the people-ask child runs #then the answer starts with the prefix marker", async () => {
    // The npm install shape spawns the interpreter with the senpi CLI entry inside senpiPrefixArgs.
    // A printer script stands in for that entry and echoes the args it received: when the prefix is
    // dropped, the interpreter itself parses the senpi flags instead, which is exactly how the real
    // failure surfaced as `node: bad option: --fork`. Using process.execPath keeps this portable.
    const dir = mkdtempSync(join(tmpdir(), "people-ask-prefix-"))
    roots.push(dir)
    const printer = join(dir, "printer.mjs")
    writeFileSync(printer, "process.stdout.write(process.argv.slice(2).join(' '))\n", "utf8")

    const model: SenpiModelPort = { provider: "omo-mock", id: "mock-1" }
    const runner = createPeopleAskRunner({
      config: { categories: { quick: { model: "omo-mock/mock-1" } } },
      registry: {
        getAvailable: () => [model],
        find: (provider, modelId) =>
          provider === model.provider && modelId === model.id ? model : undefined,
      },
      senpiCommand: process.execPath,
      senpiPrefixArgs: [printer, "PEOPLE-PREFIX-MARKER"],
    })

    const answer = await runner({
      slug: "jane-doe",
      displayName: "Jane Doe",
      question: "how does jane review?",
      evidence: { card: ["IDENTITY: staff engineer"], observations: [], searchHits: [] },
    })

    expect(answer.startsWith("PEOPLE-PREFIX-MARKER")).toBe(true)
  })
})
