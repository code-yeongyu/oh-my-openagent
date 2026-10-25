import { describe, expect, test } from "bun:test"

import { agreementId, agreementItemsOf, readAgreementsAt } from "@oh-my-opencode/memory-core"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import { registerAgreementsCommand } from "./agreements"
import { fakeCommandContext, fakeDeps, invoke, seededRepo, tempIdentity } from "./commands.test-support"

async function setup() {
  const { identity } = await tempIdentity()
  const repo = await seededRepo(identity, [])
  const deps = fakeDeps(identity)
  const pi = new MemoryFakeExtensionAPI()
  registerAgreementsCommand(pi, deps)
  const run = (args: string) => invoke(pi, "agreements", args, fakeCommandContext())
  const ledger = async () => {
    const head = await repo.head()
    return head === null ? [] : agreementItemsOf(await readAgreementsAt(repo, head))
  }
  return { repo, deps, run, ledger }
}

describe("/agreements: the person's own write path", () => {
  test("#given an empty ledger #when the person adds an agreement #then a by: human item is committed with the human-command trailer and the prompt cache is busted", async () => {
    // given
    const { repo, deps, run, ledger } = await setup()

    // when
    await run("add --project Never filter the message monitor output")

    // then
    expect(await ledger()).toEqual([{
      id: agreementId("Never filter the message monitor output"), scope: "project", by: "human",
      text: "Never filter the message monitor output", n: 0, since: expect.any(String), status: "active",
    }])
    expect((await repo.log())[0]?.trailers["Omo-Writer"]).toBe("human-command")
    expect(deps.busts).toHaveLength(1)
  }, 30_000)

  test("#given an agreement the person wrote #when the person acks it and then drops it #then ack resets the count and drop removes it", async () => {
    // given
    const { run, ledger } = await setup()
    await run("add Ask before force-pushing")
    const id = agreementId("Ask before force-pushing")

    // when
    await run(`ack ${id}`)
    const acked = await ledger()
    await run(`drop ${id}`)

    // then
    expect(acked[0]).toMatchObject({ id, n: 0, status: "active" })
    expect(await ledger()).toEqual([])
  }, 30_000)

  test("#given no such id #when the person acks it #then nothing is committed", async () => {
    // given
    const { repo, run } = await setup()
    const before = await repo.head()

    // when
    const text = await run("ack 0123456789")

    // then
    expect(text).toContain("no agreement has id 0123456789")
    expect(await repo.head()).toBe(before)
  }, 30_000)
})
