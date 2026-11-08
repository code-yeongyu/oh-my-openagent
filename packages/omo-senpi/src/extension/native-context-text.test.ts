import { describe, expect, test } from "bun:test"
import { transformContextText } from "./context-text-transform"

describe("native item context ranges", () => {
  test("#given a native item envelope #when a scoped policy changes #then its boundary and run identity are preserved", () => {
    const message = {
      customType: "omo-senpi:wake", content: "OLD",
      details: { itemId: "item", runRef: { kind: "dag", id: "run" }, items: [
        { customType: "policy", contentRange: [0, 3] },
      ] },
    }
    expect(transformContextText(message, (text, segment) => segment?.["customType"] === "policy" ? "LONGER" : text))
      .toEqual({ ...message, content: "LONGER", details: { ...message.details, items: [
        { customType: "policy", contentRange: [0, 6] },
      ] } })
  })

  test("#given two context hooks #when the earlier hook changes length #then the later hook sees the updated native range", () => {
    const message = {
      customType: "omo-senpi:wake", content: "A:D",
      details: { itemId: "item", runRef: { kind: "dag", id: "run" }, items: [
        { customType: "policy", contentRange: [0, 3] },
      ] },
    }
    const first = transformContextText(message, text => text.replace("A", "ALONG"))
    const second = transformContextText(first, (text, segment) => segment?.["customType"] === "policy" ? text.replace("D", "DN") : text)
    expect(second).toEqual({ ...message, content: "ALONG:DN", details: { ...message.details, items: [
      { customType: "policy", contentRange: [0, 8] },
    ] } })
  })
})
