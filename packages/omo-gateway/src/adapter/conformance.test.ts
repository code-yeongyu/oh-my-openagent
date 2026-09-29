import { describe, expect, test } from "bun:test"
import { FakeAdapter, FakePlatform } from "../adapters/fake/index"
import { testAdapterConformance } from "./conformance-bun"
import { CONFORMANCE_CHECKS, runAdapterConformance, type CheckId, type ConformanceReport } from "./conformance"
import type { Capabilities, InboundEvent, RenderedOp, SendResult, SurfaceKey } from "./contract"

const NOTHING: Partial<Capabilities> = {
  edit: false,
  reactions: false,
  typing: false,
  threads: false,
  thread_archive: false,
  buttons: false,
  streaming: false,
  draft_stream: false,
  uploads: false,
  rich_links: false,
  presence: false,
  chat_create: false,
  max_text: 50,
}

function statusOf(report: ConformanceReport, id: CheckId) {
  const check = report.checks.find((entry) => entry.id === id)
  if (check === undefined) throw new Error(`no check ${id}`)
  return check
}

{
  const platform = new FakePlatform({ platform: "feishu", account_id: "T000TEST" })
  testAdapterConformance("the fake adapter with every capability", () => new FakeAdapter({ platform }), () => platform.fixtures())
}

describe("runAdapterConformance on the fake adapter", () => {
  test("every capability claimed: every check passes, none skipped", async () => {
    const platform = new FakePlatform()
    const report = await runAdapterConformance(() => new FakeAdapter({ platform }), platform.fixtures())
    expect(report.checks.map((check) => check.id)).toEqual([...CONFORMANCE_CHECKS])
    expect(report.checks.filter((check) => check.status !== "pass")).toEqual([])
  })

  test("nothing claimed: every op is refused honestly and the report is still ok", async () => {
    const platform = new FakePlatform({ platform: "notion" })
    const report = await runAdapterConformance(() => new FakeAdapter({ platform, capabilities: NOTHING }), platform.fixtures())
    expect(report.ok).toBe(true)
    expect(statusOf(report, "create_chat").status).toBe("skip")
    const refusals = statusOf(report, "capability_refusals")
    expect(refusals.status).toBe("pass")
    for (const op of ["edit", "react", "typing", "upload", "open_thread", "post into a thread", "archive_thread", "create_chat", "stream_draft", "post over max_text"]) {
      expect(refusals.detail).toContain(op)
    }
  })
})

class SilentEditAdapter extends FakeAdapter {
  override async send(op: RenderedOp): Promise<SendResult> {
    if (op.op === "edit") return { message_id: op.message_id, permalink: "", created: null }
    return super.send(op)
  }
}

class UnstableReplayAdapter extends FakeAdapter {
  override async *catchUp(since: string, threads: readonly SurfaceKey[]): AsyncIterable<InboundEvent> {
    for await (const event of super.catchUp(since, threads)) yield { ...event, event_id: `replay-${event.event_id}` }
  }
}

class DishonestReactionsAdapter extends FakeAdapter {
  override capabilities(): Capabilities {
    return { ...super.capabilities(), reactions: false }
  }
}

class TopLevelThreadAdapter extends FakeAdapter {
  override async send(op: RenderedOp): Promise<SendResult> {
    if (op.op === "post" && op.key.thread_id !== null) return super.send({ ...op, key: { ...op.key, thread_id: null } })
    return super.send(op)
  }
}

class UndeclaredDraftAdapter extends FakeAdapter {
  override async send(op: RenderedOp): Promise<SendResult> {
    if (op.op === "stream_draft") return super.send({ op: "post", key: op.key, body: [{ t: "text", text: op.text }] })
    return super.send(op)
  }
}

class DraftsAsMessagesAdapter extends FakeAdapter {
  override capabilities(): Capabilities {
    return { ...super.capabilities(), draft_stream: true }
  }

  override async send(op: RenderedOp): Promise<SendResult> {
    if (op.op === "stream_draft") return super.send({ op: "post", key: op.key, body: [{ t: "text", text: op.text }] })
    return super.send(op)
  }
}

class ReusedIdAdapter extends FakeAdapter {
  override async listen(onEvent: (e: InboundEvent) => void, signal: AbortSignal, ready: () => void): Promise<void> {
    return super.listen((event) => onEvent({ ...event, event_id: "same" }), signal, ready)
  }
}

describe("runAdapterConformance catches broken adapters", () => {
  const cases: readonly (readonly [string, CheckId, (platform: FakePlatform) => FakeAdapter])[] = [
    ["an edit that silently does nothing", "edit_own_message", (platform) => new SilentEditAdapter({ platform })],
    ["catchUp that renames event ids", "dedupe_on_replay", (platform) => new UnstableReplayAdapter({ platform })],
    ["reactions reported false but still sent", "capability_refusals", (platform) => new DishonestReactionsAdapter({ platform })],
    ["thread replies posted at the top level", "thread_reply_placement", (platform) => new TopLevelThreadAdapter({ platform })],
    ["one event_id for every message", "event_id_unique", (platform) => new ReusedIdAdapter({ platform })],
    ["stream_draft performed although draft_stream is false", "stream_draft_honest", (platform) => new UndeclaredDraftAdapter({ platform })],
    ["draft_stream claimed but every stream_draft refused", "stream_draft_honest", (platform) => new FakeAdapter({ platform, capabilities: { draft_stream: true } })],
    ["draft_stream claimed but drafts posted as messages", "stream_draft_honest", (platform) => new DraftsAsMessagesAdapter({ platform })],
  ]
  for (const [name, id, make] of cases) {
    test(`${name} fails ${id}`, async () => {
      const platform = new FakePlatform()
      const report = await runAdapterConformance(() => make(platform), platform.fixtures())
      expect(report.ok).toBe(false)
      expect(statusOf(report, id).status).toBe("fail")
    })
  }

  test("an adapter whose listen never calls ready fails within the fixture timeout", async () => {
    class NeverReadyAdapter extends FakeAdapter {
      override async listen(onEvent: (e: InboundEvent) => void, signal: AbortSignal): Promise<void> {
        return super.listen(onEvent, signal, () => undefined)
      }
    }
    const platform = new FakePlatform()
    const report = await runAdapterConformance(() => new NeverReadyAdapter({ platform }), { ...platform.fixtures(), timeoutMs: 50 })
    expect(statusOf(report, "event_id_unique")).toMatchObject({ status: "fail", detail: expect.stringContaining("ready()") })
  })
})
