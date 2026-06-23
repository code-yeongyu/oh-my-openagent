import { describe, expect, test } from "bun:test"
import {
  createFragmentTracker,
  type FragmentEvent,
} from "./fragment-tracker"

function feed(
  tracker: ReturnType<typeof createFragmentTracker>,
  parsed: Record<string, unknown>,
  currentPath: string,
): FragmentEvent[] {
  return tracker.feed(parsed, currentPath)
}

describe("createFragmentTracker", () => {
  describe("#given an initial state event with a THINK fragment", () => {
    test("#when fed #then emits one reasoning event with the fragment content", () => {
      const t = createFragmentTracker()
      const events = feed(
        t,
        { v: { response: { fragments: [{ id: 2, type: "THINK", content: "我们" }] } } },
        "",
      )
      expect(events).toEqual([{ kind: "reasoning", text: "我们" }])
      expect(t.fragments()).toEqual([{ id: 2, type: "THINK" }])
    })
  })

  describe("#given an initial state event with no fragments", () => {
    test("#when fed #then returns empty events array", () => {
      const t = createFragmentTracker()
      const events = feed(t, { v: { response: { fragments: [] } } }, "")
      expect(events).toEqual([])
      expect(t.fragments()).toEqual([])
    })
  })

  describe("#given an initial state event with empty content fragment", () => {
    test("#when fed #then seeds the fragment but emits no event", () => {
      const t = createFragmentTracker()
      const events = feed(
        t,
        { v: { response: { fragments: [{ id: 2, type: "THINK", content: "" }] } } },
        "",
      )
      expect(events).toEqual([])
      expect(t.fragments()).toEqual([{ id: 2, type: "THINK" }])
    })
  })

  describe("#given an APPEND on response/fragments/-1/content with last fragment THINK", () => {
    test("#when fed #then emits a reasoning event with the appended text", () => {
      const t = createFragmentTracker()
      feed(t, { v: { response: { fragments: [{ id: 2, type: "THINK", content: "" }] } } }, "")
      const events = feed(
        t,
        { p: "response/fragments/-1/content", o: "APPEND", v: "被" },
        "response/fragments/-1/content",
      )
      expect(events).toEqual([{ kind: "reasoning", text: "被" }])
    })
  })

  describe("#given an APPEND on response/fragments/-1/content with last fragment RESPONSE", () => {
    test("#when fed #then emits a content event with the appended text", () => {
      const t = createFragmentTracker()
      feed(t, { v: { response: { fragments: [{ id: 3, type: "RESPONSE", content: "" }] } } }, "")
      const events = feed(
        t,
        { p: "response/fragments/-1/content", o: "APPEND", v: "被" },
        "response/fragments/-1/content",
      )
      expect(events).toEqual([{ kind: "content", text: "被" }])
    })
  })

  describe("#given a bare {v:'…'} after currentPath was set to /-1/content with last THINK", () => {
    test("#when fed #then emits a reasoning event resolved by currentPath", () => {
      const t = createFragmentTracker()
      feed(t, { v: { response: { fragments: [{ id: 2, type: "THINK", content: "" }] } } }, "")
      const events = feed(t, { v: "问到" }, "response/fragments/-1/content")
      expect(events).toEqual([{ kind: "reasoning", text: "问到" }])
    })
  })

  describe("#given a response/fragments APPEND adding a new RESPONSE fragment with content", () => {
    test("#when fed #then emits a content event with the seed content", () => {
      const t = createFragmentTracker()
      feed(t, { v: { response: { fragments: [{ id: 2, type: "THINK", content: "" }] } } }, "")
      const events = feed(
        t,
        {
          p: "response/fragments",
          o: "APPEND",
          v: [{ id: 3, type: "RESPONSE", content: "园" }],
        },
        "response/fragments",
      )
      expect(events).toEqual([{ kind: "content", text: "园" }])
      expect(t.fragments()).toEqual([
        { id: 2, type: "THINK" },
        { id: 3, type: "RESPONSE" },
      ])
    })
  })

  describe("#given a fragment transition to RESPONSE then a /-1/content APPEND", () => {
    test("#when fed #then the subsequent APPEND emits a content event", () => {
      const t = createFragmentTracker()
      feed(t, { v: { response: { fragments: [{ id: 2, type: "THINK", content: "" }] } } }, "")
      feed(
        t,
        {
          p: "response/fragments",
          o: "APPEND",
          v: [{ id: 3, type: "RESPONSE", content: "" }],
        },
        "response/fragments",
      )
      const events = feed(
        t,
        { p: "response/fragments/-1/content", o: "APPEND", v: "tail" },
        "response/fragments/-1/content",
      )
      expect(events).toEqual([{ kind: "content", text: "tail" }])
    })
  })

  describe("#given the legacy response/content path with a string v", () => {
    test("#when fed #then emits a content event for backward compatibility", () => {
      const t = createFragmentTracker()
      const events = feed(
        t,
        { p: "response/content", o: "APPEND", v: "hi" },
        "response/content",
      )
      expect(events).toEqual([{ kind: "content", text: "hi" }])
    })
  })

  describe("#given a response/status frame", () => {
    test("#when fed #then emits no events", () => {
      const t = createFragmentTracker()
      const events = feed(
        t,
        { p: "response/status", v: "FINISHED" },
        "response/status",
      )
      expect(events).toEqual([])
    })
  })

  describe("#given a response/fragments/-1/elapsed_secs frame", () => {
    test("#when fed #then emits no events", () => {
      const t = createFragmentTracker()
      feed(t, { v: { response: { fragments: [{ id: 2, type: "THINK", content: "" }] } } }, "")
      const events = feed(
        t,
        { p: "response/fragments/-1/elapsed_secs", v: 1.2 },
        "response/fragments/-1/elapsed_secs",
      )
      expect(events).toEqual([])
    })
  })

  describe("#given a /-1/content frame with non-string v", () => {
    test("#when fed #then emits no events", () => {
      const t = createFragmentTracker()
      feed(t, { v: { response: { fragments: [{ id: 2, type: "THINK", content: "" }] } } }, "")
      const events = feed(
        t,
        { p: "response/fragments/-1/content", o: "APPEND", v: 42 },
        "response/fragments/-1/content",
      )
      expect(events).toEqual([])
    })
  })

  describe("#given a /-1/content APPEND before any fragment was seeded", () => {
    test("#when fed #then emits no events (defensive)", () => {
      const t = createFragmentTracker()
      const events = feed(
        t,
        { p: "response/fragments/-1/content", o: "APPEND", v: "stray" },
        "response/fragments/-1/content",
      )
      expect(events).toEqual([])
    })
  })
})
