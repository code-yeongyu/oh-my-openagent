import { afterAll, afterEach, expect, test } from "bun:test"

import { creatorAnchor } from "../crypto/anchor.ts"
import { appendEntries, emptyChain } from "../crypto/chain.ts"
import { createRejectionCounter } from "../crypto/rejection.ts"
import { MAX_BATCH_BYTES, planBatches } from "../engine/batches.ts"
import { createWorld, freshStateDir, removeWorldStateDirs } from "../recovery/testing/world.test-support.ts"
import { pinTrustAnchor } from "../crypto/trust-pin.ts"
import { openAccountSession } from "./session.ts"
import { type ChainWireServer, startChainWireServer } from "./testing/chain-wire-server.test-support.ts"
import { pushItems } from "./testing/push-batch.test-support.ts"

const SPACE = new Uint8Array(16).fill(5)
// sync-design §8 record framing: type (1), space id (16), key length (2), key, body length (4), body.
const framed = (key: string, ops: number) => 1 + 16 + 2 + new TextEncoder().encode(key).length + 4 + ops

const servers: ChainWireServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop()
})
afterAll(removeWorldStateDirs)

// #12306: the receiver measures the whole payload, every record's framing included, against the
// 8 MiB plaintext limit. Items whose ops alone sum to just under the bound, under long keys, used to
// be planned as one batch that every receiver refused as payload_too_large.
test("items whose ops fill the batch bound are planned into batches every receiver opens (#12306)", async () => {
  const world = await createWorld("batch-bound")
  const server = startChainWireServer(world.account, world.server.chain(world.account))
  servers.push(server)
  const walked = await appendEntries(
    emptyChain(world.account, creatorAnchor(world.account, world.owner.keyring)),
    world.server.chain(world.account),
    createRejectionCounter(),
  )
  if (!walked.ok || walked.state.pin === null) throw new Error("the fixture genesis does not anchor")
  const pinDir = freshStateDir()
  await pinTrustAnchor(pinDir, world.account, walked.state.pin)
  const token = server.tokenFor({ ...world.owner.principal })
  const logged: string[] = []
  const opened = await openAccountSession({
    log: (line) => logged.push(line),
    baseUrl: server.url,
    token: () => token,
    account: world.account,
    keyring: world.owner.keyring,
    pinDir,
    spaceId: SPACE,
  })
  if (!opened.ok) throw new Error(`no session: ${opened.reason}`)
  const session = opened.session

  // 1024 items whose ops sum to just under 8 MiB; one of them is sized so the records before it,
  // framing included, fill the first batch to exactly the bound.
  const count = 1024
  const keyOf = (n: number) => `notes/2026/project-alpha/meeting-notes-${String(n).padStart(5, "0")}.md`
  const opsBytes = MAX_BATCH_BYTES / count - 1
  const fitting = Math.floor(MAX_BATCH_BYTES / framed(keyOf(0), opsBytes))
  const fillerOps = MAX_BATCH_BYTES - fitting * framed(keyOf(0), opsBytes) - framed(keyOf(fitting), 0)
  const items = Array.from({ length: count }, (_, n) => {
    const bytes = n === fitting ? fillerOps : opsBytes
    return { key: keyOf(n), ops: new Uint8Array(bytes).fill(0x61 + (n % 26)), bytes }
  })
  expect(items.reduce((sum, item) => sum + item.bytes, 0)).toBeLessThan(MAX_BATCH_BYTES)

  const plan = planBatches(items)
  expect(plan.held).toEqual([])
  let baseSeq = world.server.chain(world.account).length
  const received: string[] = []
  for (const batch of plan.batches) {
    baseSeq = await pushItems(session, baseSeq, batch)
    const page = await session.transport.pull(baseSeq - 1, 1)
    const entry = page.entries[0]
    if (entry === undefined || entry.seq !== baseSeq) throw new Error(`no pulled entry at ${baseSeq}`)
    const verdict = await session.verifier.verifyEntry(entry, await session.transport.download(entry.objectId))
    expect(logged.filter((line) => line.startsWith("sync.batch.rejected"))).toEqual([])
    expect(verdict).toMatchObject({ ok: true })
    if (verdict.ok) received.push(...verdict.payload.items.map((item) => item.key))
  }
  expect(received).toEqual(items.map((item) => item.key))
  const first = plan.batches[0] ?? []
  expect(first.at(-1)?.key).toBe(keyOf(fitting))
  expect(first.reduce((sum, item) => sum + framed(item.key, item.bytes), 0)).toBe(MAX_BATCH_BYTES)
}, 60_000)
