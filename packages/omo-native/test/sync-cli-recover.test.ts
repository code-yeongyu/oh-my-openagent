import { afterAll, expect, test } from "bun:test"
import { removeWorldStateDirs, verified } from "../../memory-core/src/sync/recovery/testing/world.test-support"
import { EXIT_UNSUPPORTED_HERE } from "../sync-cli"
import { words, ENROLLED, typing, runRecover } from "./sync-cli-recover.test-support"

afterAll(removeWorldStateDirs)

for (const marker of ["PI_CODING_AGENT", "AI_AGENT", "CI"] as const) {
  test(`#given ${marker} is set (even empty) #when omo sync recover runs #then it refuses with exit 2 before loading the signed-in context or opening the terminal`, async () => {
    const terminal = typing([ENROLLED.join(" ")])
    const contexts = { count: 0 }
    const r = await runRecover({ env: { [marker]: "" }, terminal: terminal.open }, { contexts })
    expect(contexts.count).toBe(0)
    expect(r.exit).toBe(EXIT_UNSUPPORTED_HERE)
    expect(r.err).toContain("Run `omo sync recover` yourself in a terminal.")
    expect(terminal.opened()).toBe(0)
  })
}

test("#given no controlling terminal #when omo sync recover runs #then it refuses with exit 2 before loading the signed-in context or opening any terminal", async () => {
  const terminal = typing([ENROLLED.join(" ")])
  const contexts = { count: 0 }
  const r = await runRecover({ terminal: terminal.open, terminalAvailable: () => false }, { contexts })
  expect(contexts.count).toBe(0)
  expect(r.exit).toBe(EXIT_UNSUPPORTED_HERE)
  expect(terminal.opened()).toBe(0)
})

test("#given the enrolled phrase typed at the terminal #when omo sync recover runs #then the device recovers through the anchored path and joins", async () => {
  const terminal = typing([ENROLLED.join(" ")])
  const r = await runRecover({ terminal: terminal.open })
  expect(r.exit).toBe(0)
  expect(r.out.join("\n")).toContain("recovered")
  const joined = (await verified(r.world, r.world.owner)).received.some(
    (record) => record.body.kind === "recovery-join",
  )
  expect(joined).toBe(true)
  expect(
    ENROLLED.filter((word) =>
      [...r.out, ...r.err]
        .join(" ")
        .split(/[^a-z]+/u)
        .includes(word),
    ),
  ).toEqual([])
})

test("#given a mistyped phrase then a cancel #when omo sync recover runs #then the terminal asks again with the typo reason and the command ends cancelled", async () => {
  const typo = [...ENROLLED.slice(0, 23), ENROLLED[23] === "zoo" ? "abandon" : "zoo"].join(" ")
  const terminal = typing([typo])
  const r = await runRecover({ terminal: terminal.open })
  expect(r.exit).toBe(1)
  expect(terminal.written.join("")).toContain("check for a typo")
  expect(r.err.join("\n")).toContain("cancelled")
})

test("#given a valid phrase this account never enrolled #when omo sync recover runs #then it refuses as history-incomplete and nothing joins", async () => {
  const terminal = typing([words(99).join(" ")])
  const r = await runRecover({ terminal: terminal.open })
  expect(r.exit).toBe(1)
  expect(r.err.join("\n")).toContain("history looks incomplete")
  const joined = (await verified(r.world, r.world.owner)).received.some(
    (record) => record.body.kind === "recovery-join",
  )
  expect(joined).toBe(false)
})

test("#given an account whose only recovery key is a passkey #when omo sync recover runs #then it says there is no recovery phrase, exits 2 and never opens the terminal", async () => {
  const terminal = typing([ENROLLED.join(" ")])
  const r = await runRecover({ terminal: terminal.open }, { plain: true })
  expect(r.exit).toBe(EXIT_UNSUPPORTED_HERE)
  expect(r.err.join("\n")).toContain("has no recovery phrase")
  expect(terminal.opened()).toBe(0)
})

test("#given a key list the service cannot serve #when omo sync recover runs #then it reports the reason, says nothing secret was stored and exits 1", async () => {
  const terminal = typing([ENROLLED.join(" ")])
  const r = await runRecover({ terminal: terminal.open }, { chain: { listKeys: async () => null } })
  expect(r.exit).toBe(1)
  expect(r.err.join("\n")).toContain("Recovery did not complete (unavailable)")
})

test("#given the enrolled phrase and a rotation append the service refuses #when omo sync recover runs #then the device joins read-only and is told to run recover again", async () => {
  const terminal = typing([ENROLLED.join(" ")])
  const r = await runRecover(
    { terminal: terminal.open },
    { chain: { appendKeys: async () => ({ ok: false, reason: "refused" }) } },
  )
  expect(r.exit).toBe(0)
  expect(r.out.join("\n")).toContain("another step is still pending")
})
