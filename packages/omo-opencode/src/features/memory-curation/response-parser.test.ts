/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  CuratorResponseParseError,
  parseCuratorResponse,
} from "./response-parser"

describe("parseCuratorResponse", () => {
  describe("#given a well-formed fenced json response", () => {
    test("#when parsed #then decisions are returned in order", () => {
      const raw = `Here is my output:

\`\`\`json
{
  "decisions": [
    { "action": "PROMOTE", "memory_id": "m_1", "target_tier": "L2", "reason": "cross-session" },
    { "action": "NOOP", "memory_id": "m_2", "reason": "already canonical" }
  ],
  "summary": "1 promoted, 1 noop",
  "warnings": []
}
\`\`\``

      const response = parseCuratorResponse(raw)

      expect(response.decisions).toHaveLength(2)
      expect(response.decisions[0]?.action).toBe("PROMOTE")
      expect(response.decisions[1]?.action).toBe("NOOP")
      expect(response.summary).toBe("1 promoted, 1 noop")
    })
  })

  describe("#given a bare JSON object (no fencing)", () => {
    test("#when parsed #then still accepted", () => {
      const raw = `{"decisions": [], "summary": "empty", "warnings": []}`
      const response = parseCuratorResponse(raw)
      expect(response.decisions).toEqual([])
      expect(response.summary).toBe("empty")
    })
  })

  describe("#given invalid JSON", () => {
    test("#when parsed #then throws CuratorResponseParseError", () => {
      expect(() => parseCuratorResponse("```json\n{not json}\n```")).toThrow(
        CuratorResponseParseError,
      )
    })
  })

  describe("#given no json block at all", () => {
    test("#when parsed #then throws CuratorResponseParseError", () => {
      expect(() => parseCuratorResponse("just some prose with no json")).toThrow(
        CuratorResponseParseError,
      )
    })
  })

  describe("#given a MERGE decision with all fields", () => {
    test("#when parsed #then all fields preserved", () => {
      const raw = `\`\`\`json
{
  "decisions": [
    {
      "action": "MERGE",
      "keep_memory_id": "m_keep",
      "merge_memory_ids": ["m_dup1", "m_dup2"],
      "reason": "same topic",
      "canonical_summary": "unified"
    }
  ],
  "summary": "1 merge"
}
\`\`\``
      const response = parseCuratorResponse(raw)
      const [decision] = response.decisions
      expect(decision?.action).toBe("MERGE")
      if (decision?.action === "MERGE") {
        expect(decision.keep_memory_id).toBe("m_keep")
        expect(decision.merge_memory_ids).toEqual(["m_dup1", "m_dup2"])
        expect(decision.canonical_summary).toBe("unified")
      }
    })
  })

  describe("#given a MERGE decision with empty merge_memory_ids", () => {
    test("#when parsed #then decision is dropped (invalid)", () => {
      const raw = `\`\`\`json
{
  "decisions": [
    { "action": "MERGE", "keep_memory_id": "m_keep", "merge_memory_ids": [], "reason": "x" }
  ],
  "summary": "x"
}
\`\`\``
      const response = parseCuratorResponse(raw)
      expect(response.decisions).toHaveLength(0)
    })
  })

  describe("#given a TAG decision with confidence out of range", () => {
    test("#when parsed #then confidence is clamped", () => {
      const raw = `\`\`\`json
{
  "decisions": [
    { "action": "TAG", "memory_id": "m_t", "patch": { "confidence": 5.5 }, "reason": "x" }
  ],
  "summary": "x"
}
\`\`\``
      const response = parseCuratorResponse(raw)
      const [decision] = response.decisions
      if (decision?.action === "TAG") {
        expect(decision.patch.confidence).toBe(1)
      } else {
        throw new Error("expected TAG decision")
      }
    })
  })

  describe("#given a SUPERSEDE with same new and old ids", () => {
    test("#when parsed #then still accepted (applicator handles)", () => {
      const raw = `\`\`\`json
{
  "decisions": [
    { "action": "SUPERSEDE", "new_memory_id": "m_x", "old_memory_id": "m_x", "reason": "self-supersede" }
  ],
  "summary": "x"
}
\`\`\``
      const response = parseCuratorResponse(raw)
      expect(response.decisions).toHaveLength(1)
    })
  })

  describe("#given an unknown action type", () => {
    test("#when parsed #then unknown actions are dropped silently", () => {
      const raw = `\`\`\`json
{
  "decisions": [
    { "action": "MYSTERY", "memory_id": "m_x" },
    { "action": "NOOP", "memory_id": "m_y", "reason": "ok" }
  ],
  "summary": "x"
}
\`\`\``
      const response = parseCuratorResponse(raw)
      expect(response.decisions).toHaveLength(1)
      expect(response.decisions[0]?.action).toBe("NOOP")
    })
  })

  describe("#given missing required fields in a decision", () => {
    test("#when parsed #then invalid decisions are dropped", () => {
      const raw = `\`\`\`json
{
  "decisions": [
    { "action": "PROMOTE", "target_tier": "L2", "reason": "no memory_id" },
    { "action": "NOOP", "memory_id": "m_ok", "reason": "ok" }
  ],
  "summary": "x"
}
\`\`\``
      const response = parseCuratorResponse(raw)
      expect(response.decisions).toHaveLength(1)
      expect(response.decisions[0]?.action).toBe("NOOP")
    })
  })
})
