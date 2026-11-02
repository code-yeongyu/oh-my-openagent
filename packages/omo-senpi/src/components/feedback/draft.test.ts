import { describe, expect, test } from "bun:test"

import { buildDraft, type UploadRedactor } from "./draft"

const redactTokens: UploadRedactor = (text) => {
  let count = 0
  const out = text.replace(/ghp_[A-Za-z0-9]{8,}/g, () => {
    count++
    return "<redacted>"
  })
  return { text: out, count }
}

describe("buildDraft", () => {
  test("#given sections collected out of order #when the draft is built #then they come back in the fixed order with the description first", () => {
    const draft = buildDraft({
      draftId: "drf_1",
      collected: [
        { id: "logs", text: "ERROR boom" },
        { id: "environment", text: "omo 5.1.36" },
      ],
      redact: redactTokens,
      destination: "intake",
      signedIn: true,
    })

    expect(draft.sections.map((section) => section.id)).toEqual(["description", "environment", "logs"])
    expect(draft.sections[0]?.text).toBe("")
  })

  test("#given a token in the transcript and the logs #when the draft is built #then the text that would be sent has it removed and counted", () => {
    const draft = buildDraft({
      draftId: "drf_2",
      collected: [
        { id: "session", text: "user: my token is ghp_abcdefgh1234" },
        { id: "logs", text: "auth ghp_zzzzzzzz9999 and ghp_yyyyyyyy8888" },
      ],
      redact: redactTokens,
      destination: "intake",
      signedIn: true,
    })

    const sent = draft.sections.map((section) => section.text).join("\n")
    expect(sent).not.toContain("ghp_")
    expect(draft.redactedCount).toBe(3)
    expect(draft.totalBytes).toBe(draft.sections.reduce((sum, section) => sum + new TextEncoder().encode(section.text).byteLength, 0))
  })

  test("#given the identity block #when the draft is built #then its values are kept because collecting them is the point", () => {
    const identity = "email dana@example.com\naccount acc_1"
    const redactEverything: UploadRedactor = (text) => ({ text: "<redacted>", count: text.length > 0 ? 1 : 0 })

    const draft = buildDraft({
      draftId: "drf_3",
      collected: [{ id: "identity", text: identity, verbatim: true }],
      redact: redactEverything,
      destination: "intake",
      signedIn: true,
    })

    expect(draft.sections.find((section) => section.id === "identity")?.text).toBe(identity)
  })
})
