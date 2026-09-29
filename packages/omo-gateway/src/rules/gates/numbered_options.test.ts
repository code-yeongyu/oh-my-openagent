import { describe, expect, it } from "bun:test"
import { gate } from "./numbered_options"
import { intentOf, post, repairedText } from "./testing"

const options = ["Ship now", "Wait for review"]

describe("numbered_options gate", () => {
  it("#given options already numbered (digit and keycap) #when run #then it passes", async () => {
    const intent = intentOf("question", [post("Which?\n1. Ship now\n2\uFE0F\u20E3 Wait for review")], { options })
    expect(await gate.run(intent, {}, {})).toEqual({ ok: true })
  })

  it("#given bullet options #when run #then they are renumbered in place", async () => {
    const intent = intentOf("question", [post("Which?\n- Ship now\n- Wait for review")], { options })
    expect(repairedText(await gate.run(intent, {}, {}))).toBe("Which?\n1. Ship now\n2. Wait for review")
  })

  it("#given options missing from the text #when run #then they are appended numbered", async () => {
    const intent = intentOf("question", [post("Ship now or later?")], { options })
    expect(repairedText(await gate.run(intent, {}, {}))).toBe("Ship now or later?\n1. Ship now\n2. Wait for review")
  })

  it("#given ten options #when run #then it is refused", async () => {
    const intent = intentOf("question", [post("Pick")], { options: Array.from({ length: 10 }, (_, i) => `o${i}`) })
    expect(await gate.run(intent, {}, {})).toHaveProperty("refuse")
  })

  it("#given an adapter with buttons #when options are unnumbered #then it passes", async () => {
    const intent = intentOf("question", [post("Which?")], { options })
    expect(await gate.run(intent, {}, { capabilities: { buttons: true, edit: true, reactions: true, typing: true, threads: true, thread_archive: true, streaming: true, draft_stream: false, uploads: true, rich_links: true, presence: true, chat_create: true, max_text: 4000 } })).toEqual({ ok: true })
  })
})
