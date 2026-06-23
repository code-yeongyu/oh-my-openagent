/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { MemoryWorkItem } from "../claude-tasks/memory-work-item"
import { projectWorkItemToCanonical } from "./work-item-projection"

function buildWorkItem(overrides: Partial<MemoryWorkItem> = {}): MemoryWorkItem {
  return {
    id: "work_test_01",
    type: "tool_observation",
    source: "hook:PostToolUse",
    project: "super-agent",
    contentSessionId: "ses_abc",
    candidateTargets: ["l1"],
    contentKind: "observation",
    importance: 0.6,
    dedupeKey: "tool_observation:hook:PostToolUse:ses_abc",
    payload: {},
    ...overrides,
  }
}

describe("projectWorkItemToCanonical", () => {
  describe("#given minimal work item", () => {
    test("#when mapping #then produces canonical draft with sensible defaults", () => {
      const { canonical } = projectWorkItemToCanonical({
        workItem: buildWorkItem(),
        targets: ["l1"],
        obsidianEnabled: false,
        memoryId: "m_test_01",
        actor: "memory-dispatcher",
      })

      expect(canonical.memory_id).toBe("m_test_01")
      expect(canonical.project_id).toBe("super-agent")
      expect(canonical.status).toBe("pending_review")
      expect(canonical.confidence).toBe(0.6)
      expect(canonical.source_kind).toBe("session")
      expect(canonical.memory_type).toBe("discovery")
      expect(canonical.provider_name).toBe("canonical")
      expect(canonical.created_by).toBe("memory-dispatcher")
      expect(canonical.promotion_origin).toBe("L1")
    })

    test("#when mapping #then defaults title and summary from type and source", () => {
      const { canonical } = projectWorkItemToCanonical({
        workItem: buildWorkItem(),
        targets: ["l1"],
        obsidianEnabled: false,
        memoryId: "m_defaults",
        actor: "memory-dispatcher",
      })

      expect(canonical.title).toBe("tool_observation:hook:PostToolUse")
      expect(canonical.summary).toContain("Work item work_test_01")
    })

    test("#when mapping #then tags fall back to contentKind", () => {
      const { canonical } = projectWorkItemToCanonical({
        workItem: buildWorkItem({ contentKind: "document" }),
        targets: ["l1"],
        obsidianEnabled: false,
        memoryId: "m_tag",
        actor: "memory-dispatcher",
      })

      expect(canonical.tags).toEqual(["document"])
    })
  })

  describe("#given explicit payload fields", () => {
    test("#when title provided #then canonical title reflects it", () => {
      const { canonical } = projectWorkItemToCanonical({
        workItem: buildWorkItem({
          payload: { title: "Redis setup on prod" },
        }),
        targets: ["l2"],
        obsidianEnabled: false,
        memoryId: "m_title",
        actor: "memory-dispatcher",
      })

      expect(canonical.title).toBe("Redis setup on prod")
    })

    test("#when summary provided #then canonical summary reflects it", () => {
      const { canonical } = projectWorkItemToCanonical({
        workItem: buildWorkItem({
          payload: { summary: "Configured Redis Sentinel with 3 nodes" },
        }),
        targets: ["l2"],
        obsidianEnabled: false,
        memoryId: "m_summary",
        actor: "memory-dispatcher",
      })

      expect(canonical.summary).toBe("Configured Redis Sentinel with 3 nodes")
    })

    test("#when evidence array provided #then canonical carries strings only", () => {
      const { canonical } = projectWorkItemToCanonical({
        workItem: buildWorkItem({
          payload: { evidence: ["file.ts:10", 123, "other.ts:42"] },
        }),
        targets: ["l1"],
        obsidianEnabled: false,
        memoryId: "m_evidence",
        actor: "memory-dispatcher",
      })

      expect(canonical.evidence).toEqual(["file.ts:10", "other.ts:42"])
    })

    test("#when url in payload #then evidence falls back to url", () => {
      const { canonical } = projectWorkItemToCanonical({
        workItem: buildWorkItem({
          payload: { url: "https://example.com/doc" },
        }),
        targets: ["l1"],
        obsidianEnabled: false,
        memoryId: "m_url_evidence",
        actor: "memory-dispatcher",
      })

      expect(canonical.evidence).toEqual(["https://example.com/doc"])
    })

    test("#when url in payload #then source_refs include it", () => {
      const { canonical } = projectWorkItemToCanonical({
        workItem: buildWorkItem({
          payload: { url: "https://example.com/doc", tool_name: "webfetch", call_id: "c_1" },
        }),
        targets: ["l1"],
        obsidianEnabled: false,
        memoryId: "m_refs",
        actor: "memory-dispatcher",
      })

      expect(canonical.source_refs).toMatchObject({
        work_item_id: "work_test_01",
        url: "https://example.com/doc",
        tool_name: "webfetch",
        call_id: "c_1",
      })
    })
  })

  describe("#given work item type variants", () => {
    test("#when type is document_candidate #then memory_type is discovery", () => {
      const { canonical } = projectWorkItemToCanonical({
        workItem: buildWorkItem({ type: "document_candidate" }),
        targets: ["l3"],
        obsidianEnabled: false,
        memoryId: "m_doc",
        actor: "memory-dispatcher",
      })

      expect(canonical.memory_type).toBe("discovery")
    })

    test("#when type is promotion_candidate #then memory_type is decision", () => {
      const { canonical } = projectWorkItemToCanonical({
        workItem: buildWorkItem({ type: "promotion_candidate" }),
        targets: ["l2"],
        obsidianEnabled: false,
        memoryId: "m_prom",
        actor: "memory-dispatcher",
      })

      expect(canonical.memory_type).toBe("decision")
    })

    test("#when type is preference_candidate #then memory_type is convention", () => {
      const { canonical } = projectWorkItemToCanonical({
        workItem: buildWorkItem({ type: "preference_candidate" }),
        targets: ["l2"],
        obsidianEnabled: false,
        memoryId: "m_pref",
        actor: "memory-dispatcher",
      })

      expect(canonical.memory_type).toBe("convention")
    })
  })

  describe("#given source variants", () => {
    test("#when source starts with corpus: #then source_kind is corpus", () => {
      const { canonical } = projectWorkItemToCanonical({
        workItem: buildWorkItem({ source: "corpus:arxiv" }),
        targets: ["l3"],
        obsidianEnabled: false,
        memoryId: "m_corpus",
        actor: "memory-dispatcher",
      })

      expect(canonical.source_kind).toBe("corpus")
    })

    test("#when source starts with agent: #then source_kind is agent", () => {
      const { canonical } = projectWorkItemToCanonical({
        workItem: buildWorkItem({ source: "agent:scout" }),
        targets: ["l1"],
        obsidianEnabled: false,
        memoryId: "m_agent",
        actor: "memory-dispatcher",
      })

      expect(canonical.source_kind).toBe("agent")
    })
  })

  describe("#given importance edge cases", () => {
    test("#when importance is 0 #then confidence clamps to 0", () => {
      const { canonical } = projectWorkItemToCanonical({
        workItem: buildWorkItem({ importance: -1 }),
        targets: ["l1"],
        obsidianEnabled: false,
        memoryId: "m_neg",
        actor: "memory-dispatcher",
      })

      expect(canonical.confidence).toBe(0)
    })

    test("#when importance is >1 #then confidence clamps to 1", () => {
      const { canonical } = projectWorkItemToCanonical({
        workItem: buildWorkItem({ importance: 5 }),
        targets: ["l1"],
        obsidianEnabled: false,
        memoryId: "m_big",
        actor: "memory-dispatcher",
      })

      expect(canonical.confidence).toBe(1)
    })

    test("#when importance is NaN #then confidence falls back to default", () => {
      const { canonical } = projectWorkItemToCanonical({
        workItem: buildWorkItem({ importance: Number.NaN }),
        targets: ["l1"],
        obsidianEnabled: false,
        memoryId: "m_nan",
        actor: "memory-dispatcher",
      })

      expect(canonical.confidence).toBe(0.5)
    })
  })

  describe("#given outbox generation", () => {
    test("#when three targets #then outbox has three entries plus audit fields", () => {
      const { outbox } = projectWorkItemToCanonical({
        workItem: buildWorkItem(),
        targets: ["l1", "l2", "l3"],
        obsidianEnabled: false,
        memoryId: "m_multi",
        actor: "memory-dispatcher",
      })

      expect(outbox).toHaveLength(3)
      expect(outbox.map((e) => e.provider_name).sort()).toEqual([
        "claude-mem",
        "corpus-ingestor",
        "mem0",
      ])
      for (const entry of outbox) {
        expect(entry.memory_id).toBe("m_multi")
        expect(entry.status).toBe("pending")
        expect(entry.operation).toBe("create")
      }
    })

    test("#when obsidian enabled #then outbox contains an obsidian entry", () => {
      const { outbox } = projectWorkItemToCanonical({
        workItem: buildWorkItem(),
        targets: ["l1"],
        obsidianEnabled: true,
        memoryId: "m_obs",
        actor: "memory-dispatcher",
      })

      const obsidianEntry = outbox.find((entry) => entry.provider_name === "obsidian")
      expect(obsidianEntry).toBeDefined()
      expect(obsidianEntry?.outbox_id).toBe("m_obs:obsidian")
    })

    test("#when obsidian disabled #then no obsidian entry appears", () => {
      const { outbox } = projectWorkItemToCanonical({
        workItem: buildWorkItem(),
        targets: ["l1"],
        obsidianEnabled: false,
        memoryId: "m_noobs",
        actor: "memory-dispatcher",
      })

      expect(outbox.find((entry) => entry.provider_name === "obsidian")).toBeUndefined()
    })

    test("#when dedupeKey set #then idempotency key combines dedupe and target", () => {
      const { outbox } = projectWorkItemToCanonical({
        workItem: buildWorkItem({ dedupeKey: "tool_observation:webfetch:ses_abc:url-hash" }),
        targets: ["l1", "l2"],
        obsidianEnabled: true,
        memoryId: "m_dedupe",
        actor: "memory-dispatcher",
      })

      expect(outbox.find((entry) => entry.provider_name === "claude-mem")?.idempotency_key).toBe(
        "tool_observation:webfetch:ses_abc:url-hash:l1",
      )
      expect(outbox.find((entry) => entry.provider_name === "mem0")?.idempotency_key).toBe(
        "tool_observation:webfetch:ses_abc:url-hash:l2",
      )
      expect(outbox.find((entry) => entry.provider_name === "obsidian")?.idempotency_key).toBe(
        "tool_observation:webfetch:ses_abc:url-hash:obsidian",
      )
    })
  })

  describe("#given title that exceeds limit", () => {
    test("#when title is 120 chars #then canonical truncates to 80", () => {
      const longTitle = "a".repeat(120)
      const { canonical } = projectWorkItemToCanonical({
        workItem: buildWorkItem({ payload: { title: longTitle } }),
        targets: ["l1"],
        obsidianEnabled: false,
        memoryId: "m_trunc",
        actor: "memory-dispatcher",
      })

      expect(canonical.title.length).toBe(80)
      expect(canonical.title.endsWith("…")).toBe(true)
    })
  })
})
