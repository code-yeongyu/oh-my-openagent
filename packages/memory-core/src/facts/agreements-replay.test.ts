import { expect, onTestFinished, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { agreementItemsOf, renderAgreementsFile } from "../agreements/ledger-file"
import { agreementId, parseAgreementsLedger } from "../agreements/format"
import { ackAgreement, dropAgreement } from "../agreements/mutate"
import { describeAgreementsToolViolation } from "../agreements/guard"
import { parseAgreementRecord } from "../agreements/record"
import { AGREEMENTS_PATH, DEFAULT_AGREEMENTS_POLICY, type AgreementExtractionRecord } from "../agreements/types"
import { GitMemoryRepo } from "../git"
import { parseMemoryFile } from "../memfs"
import { renderAgreementsTarget } from "./agreements-target"
import { applyFactsBatch } from "./extraction"

const TEXT = "Run the relevant tests before reporting completion"
const DATE = "2026-10-01"
const AUTHOR = { agentId: "fixture", authorName: "Fixture" }
const record = (messageId: string, sessionId = "session-a") => ({
  action: "new" as const, applies: "global" as const, text: TEXT, date: DATE,
  source: { sessionId, messageId },
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agreement-replay-"))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, "system"))
  const path = join(root, AGREEMENTS_PATH)
  const apply = async (records: readonly AgreementExtractionRecord[]) => {
    const target = await renderAgreementsTarget(root, records, DEFAULT_AGREEMENTS_POLICY)
    if (target.content !== undefined) await writeFile(path, target.content)
    return agreementItemsOf(await readFile(path, "utf8"))
  }
  return { root, path, apply }
}

test("one source event counts once within and across persisted extractions", async () => {
  const { apply, path } = await fixture()
  expect((await apply([record("turn-1"), record("turn-1")]))[0]?.n).toBe(1)
  const before = await readFile(path, "utf8")
  expect((await apply([record("turn-1")]))[0]?.n).toBe(1)
  expect((await apply([{ ...record("turn-1"), date: "2026-10-02" }]))[0]?.n).toBe(1)
  expect(await readFile(path, "utf8")).toBe(before)
})

test("distinct turns on one date and equal message ids in separate sessions each count", async () => {
  const { apply } = await fixture()
  expect((await apply([record("turn-1"), record("turn-2")]))[0]?.n).toBe(2)
  expect((await apply([record("turn-1", "session-b")]))[0]?.n).toBe(3)
})

test("legacy identityless records count at most once per agreement and date", async () => {
  const { source: _source, ...legacy } = record("unused")
  const { apply } = await fixture()
  expect((await apply([legacy]))[0]?.n).toBe(1)
  expect((await apply([legacy, legacy]))[0]?.n).toBe(1)
  expect((await apply([{ ...legacy, date: "2026-10-02" }]))[0]?.n).toBe(2)
})

test("a legacy last-date seed survives a modern correction before pending legacy replay", async () => {
  const { apply, path } = await fixture()
  const id = agreementId(TEXT)
  await writeFile(path, renderAgreementsFile(undefined, [{
    id, scope: "global", by: "agent", text: TEXT, n: 1,
    since: DATE, last: DATE, status: "active",
  }]))

  expect((await apply([{ ...record("modern"), date: "2026-10-02" }]))[0]?.n).toBe(2)
  expect((await apply([{ action: "reaffirm", id, date: DATE }]))[0]?.n).toBe(2)
})

test("modern events add one source receipt each without later date seeds from acknowledgements", async () => {
  const { apply, path } = await fixture()
  await apply([record("turn-1")])
  expect(parseAgreementsLedger(parseMemoryFile(await readFile(path, "utf8")).body).receipts).toHaveLength(1)
  const items = await apply([{ ...record("turn-2"), date: "2026-10-02" }])
  const id = items[0]?.id
  if (id === undefined) throw new Error("missing agreement")
  const acknowledged = ackAgreement(items, id)
  if (acknowledged === undefined) throw new Error("ack failed")
  await writeFile(path, renderAgreementsFile(await readFile(path, "utf8"), acknowledged))
  expect(parseAgreementsLedger(parseMemoryFile(await readFile(path, "utf8")).body).receipts).toHaveLength(2)
})

test("a reworded new record adds two source keys rather than four source and date keys", async () => {
  const { apply, path } = await fixture()
  const initial = await apply([record("turn-1")])
  const id = initial[0]?.id
  if (id === undefined) throw new Error("missing agreement")
  const text = "Run every relevant test before reporting completion"
  await apply([{ action: "reaffirm", id, text, date: "2026-10-02", source: { sessionId: "session-a", messageId: "turn-2" } }])
  await apply([{ ...record("turn-3"), text, date: "2026-10-03" }])
  expect(parseAgreementsLedger(parseMemoryFile(await readFile(path, "utf8")).body).receipts).toHaveLength(4)
})

test("an unsourced date does not alias a modern event after migration", async () => {
  const { apply } = await fixture()
  const modern = record("turn-1")
  expect((await apply([modern]))[0]?.n).toBe(1)
  const { source: _source, ...legacy } = modern
  expect((await apply([legacy]))[0]?.n).toBe(2)
  expect((await apply([legacy]))[0]?.n).toBe(2)
})

test("acknowledge and drop retain history without suppressing a distinct future turn", async () => {
  const { apply, path } = await fixture()
  const items = await apply([record("turn-1")])
  const id = items[0]?.id
  if (id === undefined) throw new Error("missing agreement")
  const acknowledged = ackAgreement(items, id)
  if (acknowledged === undefined) throw new Error("ack failed")
  await writeFile(path, renderAgreementsFile(await readFile(path, "utf8"), acknowledged))
  expect((await apply([record("turn-1")]))[0]?.n).toBe(0)
  const dropped = dropAgreement(acknowledged, id)
  if (dropped === undefined) throw new Error("drop failed")
  await writeFile(path, renderAgreementsFile(await readFile(path, "utf8"), dropped))
  expect(await apply([record("turn-1")])).toEqual([])
  expect((await apply([record("turn-2")]))[0]?.n).toBe(1)
})

test("source identity survives the extraction parser", () => {
  expect(parseAgreementRecord(record("turn-1"), 0)).toEqual(record("turn-1"))
})

test("a receipt-only dropped ledger cannot be deleted or edited through memory tools", async () => {
  const { apply, path } = await fixture()
  await apply([record("turn-1")])
  const dropped = renderAgreementsFile(await readFile(path, "utf8"), [])
  expect(describeAgreementsToolViolation(dropped, undefined)).toBeDefined()
  expect(describeAgreementsToolViolation(dropped, "---\ndescription: Agreements\n---\n")).toBeDefined()
  const forged = `<!-- agreement-event: ${"a".repeat(64)} -->`
  expect(describeAgreementsToolViolation(dropped, `${dropped}${forged}\n`)).toBeDefined()
  expect(describeAgreementsToolViolation(dropped, dropped.replace(/<!-- agreement-event: [0-9a-f]{64} -->/, forged))).toBeDefined()
  expect(describeAgreementsToolViolation(undefined, `---\ndescription: Agreements\n---\n${forged}\n`)).toBeDefined()
  expect(describeAgreementsToolViolation(dropped, dropped)).toBeUndefined()
})

test("cap eviction retains the source receipt without recreating the evicted agreement", async () => {
  const { root, path, apply } = await fixture()
  await apply([record("turn-1")])
  const next = { ...record("turn-2"), text: "Keep the fixture isolated" }
  const evicted = await renderAgreementsTarget(root, [next], { ...DEFAULT_AGREEMENTS_POLICY, maxItems: 1 })
  if (evicted.content === undefined) throw new Error("expected eviction")
  await writeFile(path, evicted.content)
  const replayed = await renderAgreementsTarget(root, [record("turn-1")], { ...DEFAULT_AGREEMENTS_POLICY, maxItems: 1 })
  expect(replayed.content).toBeUndefined()
  expect(agreementItemsOf(await readFile(path, "utf8"))[0]?.text).toBe(next.text)
})

test("a new record matched by reworded text remains deduplicated after drop", async () => {
  const { apply, path } = await fixture()
  const initial = await apply([record("turn-1")])
  const id = initial[0]?.id
  if (id === undefined) throw new Error("missing agreement")
  const text = "Run every relevant test before reporting completion"
  await apply([{ action: "reaffirm", id, text, date: DATE, source: { sessionId: "session-a", messageId: "turn-2" } }])
  const replay = { ...record("turn-3"), text }
  expect((await apply([replay]))[0]?.n).toBe(3)
  await writeFile(path, renderAgreementsFile(await readFile(path, "utf8"), []))
  expect(await apply([replay])).toEqual([])
})

test("a replay alias learned before cap eviction is retained within the same batch", async () => {
  const { root, path, apply } = await fixture()
  const other = { ...record("other"), text: "Keep the fixture isolated", date: "2026-10-02" }
  const items = await apply([record("turn-1"), other])
  const text = "Run every relevant test before reporting completion"
  await writeFile(path, renderAgreementsFile(await readFile(path, "utf8"),
    items.map((item) => item.text === TEXT ? { ...item, text } : item)))
  const replay = { ...record("turn-1"), text }
  const fresh = { ...record("fresh"), text: "Preserve fixture output", date: "2026-10-03" }
  const target = await renderAgreementsTarget(root, [replay, fresh, replay], { ...DEFAULT_AGREEMENTS_POLICY, maxItems: 2 })
  expect(agreementItemsOf(target.content).map((item) => item.text).sort()).toEqual([other.text, fresh.text].sort())
})

test("independent committed batches replay one event without a second increment", async () => {
  const { root } = await fixture()
  const repo = new GitMemoryRepo({ dir: root, agentId: "fixture" })
  await repo.init({ seedFiles: [{ relativePath: "system/persona.md", content: "---\ndescription: Fixture\n---\n" }] })
  const batch = () => ({ batchId: randomUUID(), records: [], agreements: [record("turn-1")] })
  expect((await applyFactsBatch(repo, batch(), AUTHOR)).outcome).toBe("committed")
  const head = await repo.head()
  expect((await applyFactsBatch(repo, batch(), AUTHOR)).outcome).toBe("no_facts")
  expect(await repo.head()).toBe(head)
  expect(agreementItemsOf(await readFile(join(root, AGREEMENTS_PATH), "utf8"))[0]?.n).toBe(1)
  expect((await repo.status()).trim()).toBe("")
}, 30_000)
