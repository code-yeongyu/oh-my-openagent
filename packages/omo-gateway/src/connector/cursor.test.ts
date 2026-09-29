import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { InboundEvent } from "../adapter/contract"
import { CATCH_UP_OVERLAP_MS, ConnectorCursor, INITIAL_LOOKBACK_MS, SEEN_CAP } from "./cursor"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function cursorFile(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-gateway-cursor-"))
  roots.push(root)
  return join(root, "slack-T000TEST.cursor.json")
}

function event(id: string, at: string, thread_id: string | null = null): InboundEvent {
  return {
    event_id: id,
    key: { platform: "slack", account_id: "T000TEST", chat_id: "C000TEST", thread_id },
    author: { platform_user_id: "U000ALICE", display: "Alice", is_bot: false },
    kind: thread_id === null ? "channel" : "thread_reply",
    reaction: null,
    edited: null,
    gateway_marker: false,
    text: "hello",
    transcript: null,
    attachments: [],
    reply_to: null,
    at,
    permalink: "https://fake.invalid/x",
  }
}

const NOW = Date.parse("2026-09-29T12:00:00.000Z")

describe("dedupe cursor", () => {
  test("#given no cursor file #when loaded #then it starts empty, looking back ten minutes", async () => {
    // when
    const cursor = await ConnectorCursor.load(cursorFile(), { now: () => NOW })

    // then
    expect(cursor.seenCount).toBe(0)
    expect(cursor.watermark).toBe(new Date(NOW - INITIAL_LOOKBACK_MS).toISOString())
  })

  test("#given recorded events #when saved and reloaded #then seen ids, watermark and threads survive, 0600, no temp left", async () => {
    // given
    const path = cursorFile()
    const cursor = await ConnectorCursor.load(path, { now: () => NOW })
    cursor.record(event("e1", "2026-09-29T12:01:00.000Z"))
    cursor.record(event("e2", "2026-09-29T12:00:30.000Z", "th1"))

    // when
    await cursor.save()
    const reloaded = await ConnectorCursor.load(path, { now: () => NOW })

    // then
    expect(reloaded.hasSeen("e1") && reloaded.hasSeen("e2")).toBe(true)
    expect(reloaded.hasSeen("e3")).toBe(false)
    expect(reloaded.watermark).toBe("2026-09-29T12:01:00.000Z")
    expect(reloaded.catchUpSince()).toBe(new Date(Date.parse("2026-09-29T12:01:00.000Z") - CATCH_UP_OVERLAP_MS).toISOString())
    expect(reloaded.threads().map((key) => key.thread_id)).toEqual(["th1"])
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(readdirSync(join(path, "..")).filter((name) => name.endsWith(".tmp"))).toEqual([])
  })

  test("#given more ids than the cap #when recorded #then the oldest are forgotten first", async () => {
    // given
    const cursor = await ConnectorCursor.load(cursorFile(), { now: () => NOW })

    // when
    for (let index = 0; index < SEEN_CAP + 5; index += 1) cursor.record(event(`e${index}`, "2026-09-29T12:00:00.000Z"))

    // then
    expect(cursor.seenCount).toBe(SEEN_CAP)
    expect(cursor.hasSeen("e4")).toBe(false)
    expect(cursor.hasSeen("e5")).toBe(true)
  })

  test("#given a corrupt cursor file #when loaded #then it is moved aside and the cursor starts fresh", async () => {
    // given
    const path = cursorFile()
    writeFileSync(path, "{ torn")
    const moved: string[] = []

    // when
    const cursor = await ConnectorCursor.load(path, { now: () => NOW, onCorrupt: (to) => moved.push(to) })

    // then
    expect(cursor.seenCount).toBe(0)
    expect(moved).toEqual([`${path}.corrupt-${NOW}`])
    expect(existsSync(`${path}.corrupt-${NOW}`)).toBe(true)
    expect(existsSync(path)).toBe(false)
  })
})
