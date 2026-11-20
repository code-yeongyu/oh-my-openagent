import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { PAIR_BUCKET_REFILL_MS, QUEUED_TTL_MS, RETENTION_SWEEP_INTERVAL_MS, TARGET_MAX_MESSAGES } from "./constants"
import { gatewayDatabasePath, gatewayInboxDirectory } from "./paths"
import { processStartTime } from "./process-identity"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import type { GatewayDeliveryResult, ProcessIdentity } from "./types"

let harness: GatewayHarness | undefined

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function open(): GatewayHarness {
  harness = createGatewayHarness()
  harness.session("A")
  harness.session("T", { online: false })
  return harness
}

function send(
  h: GatewayHarness,
  to: string,
  text: string,
  advance = PAIR_BUCKET_REFILL_MS,
): Promise<GatewayDeliveryResult> {
  h.clock.now += advance
  return h
    .get("A")
    .engine.deliver({ sender: { kind: "session", durable_id: "A" }, target: to, text, mode: "follow_up" })
}

function summary(result: GatewayDeliveryResult): string {
  return result.kind === "ok" ? result.delivery.kind : `error:${result.error.code}`
}

async function fill(h: GatewayHarness, to: string, count: number): Promise<string[]> {
  const ids: string[] = []
  for (let index = 0; index < count; index++) {
    const result = await send(h, to, `line ${index}`)
    if (result.kind !== "ok") throw new Error(`fill ${index}: ${JSON.stringify(result)}`)
    ids.push(result.delivery_id)
  }
  return ids
}

async function rows(h: GatewayHarness, target: string) {
  return await h.get("A").store.list({ target_durable_id: target })
}

function holdAll(h: GatewayHarness, target: string, holder: ProcessIdentity): void {
  const db = new Database(gatewayDatabasePath(h.agentDir))
  try {
    db.run(
      "UPDATE deliveries SET state = 'admitted', admitted_by = ?, claimed_at = ?, attempt = 1, admission_kind = 'queued' WHERE target_durable_id = ?",
      [JSON.stringify(holder), h.clock.now, target],
    )
  } finally {
    db.close()
  }
}

function markIntake(h: GatewayHarness, deliveryId: string): void {
  const db = new Database(gatewayDatabasePath(h.agentDir))
  try {
    db.run("UPDATE deliveries SET ledger_id = ? WHERE delivery_id = ?", [`ledger-${deliveryId}`, deliveryId])
  } finally {
    db.close()
  }
}

async function identityOf(pid: number): Promise<ProcessIdentity> {
  return { pid, process_start_time: await processStartTime(pid), instance_id: randomUUID(), runtime_instance: null }
}

async function deadIdentity(): Promise<ProcessIdentity> {
  const child = Bun.spawn(["true"], { stdout: "ignore", stderr: "ignore" })
  const identity = await identityOf(child.pid)
  await child.exited
  return identity
}

describe("a target that is not running", () => {
  test("#given a full backlog #when a send is refused #then it says the target is not running and when the oldest queued row frees its slot", async () => {
    const h = open()
    const ids = await fill(h, "T", TARGET_MAX_MESSAGES)
    const first = (await rows(h, "T")).find((row) => row.delivery_id === ids[0])

    const refused = await send(h, "T", "one more")

    expect(summary(refused)).toBe("error:queue_full")
    if (refused.kind !== "error") throw new Error("expected a refusal")
    expect(refused.error.details).toMatchObject({ target_running: false, frees_at: first?.expires_at })
  }, 30_000)

  test("#given a full backlog #when its oldest row passes the queued TTL #then that row is refused expired, one send is accepted, and the next is refused again", async () => {
    const h = open()
    const ids = await fill(h, "T", TARGET_MAX_MESSAGES)
    const first = (await rows(h, "T")).find((row) => row.delivery_id === ids[0])
    if (first === undefined) throw new Error("no first row")
    h.clock.now = first.expires_at - PAIR_BUCKET_REFILL_MS

    expect(summary(await send(h, "T", "after the first expired"))).toBe("queued_offline")
    expect(summary(await send(h, "T", "while the rest are still live", 0))).toBe("error:queue_full")

    const after = await rows(h, "T")
    expect(after.find((row) => row.delivery_id === ids[0])).toMatchObject({ state: "refused", reason: "expired" })
    expect(after.filter((row) => row.state === "queued")).toHaveLength(TARGET_MAX_MESSAGES)
    expect(existsSync(join(gatewayInboxDirectory(h.agentDir, "T"), ids[0] as string))).toBe(false)
  }, 30_000)

  test("#given rows a runtime took and then died holding #when they pass the queued TTL #then they stop counting and stay for the target's own reconcile", async () => {
    const h = open()
    await fill(h, "T", TARGET_MAX_MESSAGES)
    holdAll(h, "T", await deadIdentity())
    expect(summary(await send(h, "T", "before the TTL"))).toBe("error:queue_full")

    h.clock.now += QUEUED_TTL_MS

    expect(summary(await send(h, "T", "after the TTL"))).toBe("queued_offline")
    const states = (await rows(h, "T")).map((row) => row.state)
    expect(states.filter((state) => state === "admitted")).toHaveLength(TARGET_MAX_MESSAGES)
    expect(states.filter((state) => state === "queued")).toHaveLength(1)
  }, 30_000)

  test("#given rows a live runtime still holds #when they pass the queued TTL #then they keep counting, because that runtime can still write them", async () => {
    const h = open()
    await fill(h, "T", TARGET_MAX_MESSAGES)
    holdAll(h, "T", await identityOf(process.pid))

    h.clock.now += QUEUED_TTL_MS

    expect(summary(await send(h, "T", "after the TTL"))).toBe("error:queue_full")
  }, 30_000)

  test("#given a full backlog whose only expired row is an intake row #when a send arrives #then that row stops counting but stays queued, because only the target's reconcile can tell whether it already reached the transcript", async () => {
    const h = open()
    const ids = await fill(h, "T", TARGET_MAX_MESSAGES)
    const intake = ids[0] as string
    markIntake(h, intake)
    const first = (await rows(h, "T")).find((row) => row.delivery_id === intake)
    if (first === undefined) throw new Error("no intake row")
    h.clock.now = first.expires_at - PAIR_BUCKET_REFILL_MS

    expect(summary(await send(h, "T", "after the intake row expired"))).toBe("queued_offline")
    expect(summary(await send(h, "T", "while the rest are still live", 0))).toBe("error:queue_full")

    expect((await rows(h, "T")).find((row) => row.delivery_id === intake)).toMatchObject({ state: "queued" })
    expect(existsSync(join(gatewayInboxDirectory(h.agentDir, "T"), intake))).toBe(true)
  }, 30_000)

  test("#given queued rows past their TTL and no further send to that target #when the retention sweep runs on another write #then they are refused expired and their inbox markers are gone", async () => {
    const h = open()
    h.session("X", { online: false })
    const ids = await fill(h, "T", 3)

    h.clock.now += QUEUED_TTL_MS + RETENTION_SWEEP_INTERVAL_MS

    expect(summary(await send(h, "X", "unrelated"))).toBe("queued_offline")
    for (const row of (await rows(h, "T")).filter((found) => ids.includes(found.delivery_id)))
      expect(row).toMatchObject({ state: "refused", reason: "expired" })
    for (const id of ids) expect(existsSync(join(gatewayInboxDirectory(h.agentDir, "T"), id))).toBe(false)
  }, 30_000)
})
