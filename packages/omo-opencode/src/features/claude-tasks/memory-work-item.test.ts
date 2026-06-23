import { describe, test, expect } from "bun:test"
import {
  MemoryTarget,
  MemoryWorkItemType,
  type MemoryWorkItem,
  buildMemoryWorkItemDedupeKey,
} from "./memory-work-item"

function makeItem(overrides: Partial<MemoryWorkItem> = {}): MemoryWorkItem {
  return {
    id: "wi-001",
    type: "tool_observation",
    source: "hook:PostToolUse",
    project: "super-agent",
    contentSessionId: "ses_abc123",
    candidateTargets: ["l1"],
    contentKind: "observation",
    importance: 0.7,
    dedupeKey: "tool_observation:hook:PostToolUse:ses_abc123",
    payload: {},
    ...overrides,
  }
}

describe("MemoryTarget", () => {
  test("enumerates l1 l2 l3", () => {
    const targets: MemoryTarget[] = ["l1", "l2", "l3"]
    expect(targets).toHaveLength(3)
    expect(targets).toContain("l1")
    expect(targets).toContain("l2")
    expect(targets).toContain("l3")
  })
})

describe("MemoryWorkItemType", () => {
  test("enumerates all five variants", () => {
    const types: MemoryWorkItemType[] = [
      "tool_observation",
      "session_summary",
      "preference_candidate",
      "document_candidate",
      "promotion_candidate",
    ]
    expect(types).toHaveLength(5)
    for (const t of types) {
      expect(types).toContain(t)
    }
  })
})

describe("MemoryWorkItem", () => {
  test("exposes all required fields with correct values", () => {
    const item = makeItem()
    expect(item.id).toBe("wi-001")
    expect(item.type).toBe("tool_observation")
    expect(item.source).toBe("hook:PostToolUse")
    expect(item.project).toBe("super-agent")
    expect(item.contentSessionId).toBe("ses_abc123")
    expect(item.candidateTargets).toEqual(["l1"])
    expect(item.contentKind).toBe("observation")
    expect(item.importance).toBe(0.7)
    expect(item.dedupeKey).toBe("tool_observation:hook:PostToolUse:ses_abc123")
    expect(item.payload).toEqual({})
  })

  test("candidateTargets accepts all MemoryTarget values", () => {
    const item = makeItem({ candidateTargets: ["l1", "l2", "l3"] })
    expect(item.candidateTargets).toEqual(["l1", "l2", "l3"])
  })

  test("payload carries arbitrary structured data", () => {
    const item = makeItem({ payload: { url: "https://example.com", title: "Docs" } })
    expect(item.payload).toEqual({ url: "https://example.com", title: "Docs" })
  })
})

describe("buildMemoryWorkItemDedupeKey", () => {
  test("joins type, source, and sessionId with colons", () => {
    expect(buildMemoryWorkItemDedupeKey("tool_observation", "hook:PostToolUse", "ses_abc123"))
      .toBe("tool_observation:hook:PostToolUse:ses_abc123")
  })

  test("differentiates by type", () => {
    expect(
      buildMemoryWorkItemDedupeKey("tool_observation", "hook:PostToolUse", "ses_abc123"),
    ).not.toBe(
      buildMemoryWorkItemDedupeKey("session_summary", "hook:PostToolUse", "ses_abc123"),
    )
  })

  test("differentiates by source", () => {
    expect(
      buildMemoryWorkItemDedupeKey("tool_observation", "hook:PostToolUse", "ses_abc123"),
    ).not.toBe(
      buildMemoryWorkItemDedupeKey("tool_observation", "hook:Stop", "ses_abc123"),
    )
  })

  test("differentiates by sessionId", () => {
    expect(
      buildMemoryWorkItemDedupeKey("tool_observation", "hook:PostToolUse", "ses_abc123"),
    ).not.toBe(
      buildMemoryWorkItemDedupeKey("tool_observation", "hook:PostToolUse", "ses_def456"),
    )
  })

  test("is idempotent for identical inputs", () => {
    const key1 = buildMemoryWorkItemDedupeKey("preference_candidate", "orchestrator", "ses_xyz789")
    const key2 = buildMemoryWorkItemDedupeKey("preference_candidate", "orchestrator", "ses_xyz789")
    expect(key1).toBe(key2)
  })
})