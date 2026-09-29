import type { Check } from "./types"
import { expect, expectRefusal } from "./wait"

const DRAFT_ID = "7001"

export const streamDraftHonest: Check = async ({ makeAdapter, fixtures, marker }) => {
  const adapter = await makeAdapter()
  if (!adapter.capabilities().draft_stream) {
    await expectRefusal(() => adapter.send({ op: "stream_draft", key: fixtures.chat, draft_id: DRAFT_ID, text: "draft", final: false }), ["draft_stream"], "stream_draft")
    return "draft_stream is false; stream_draft was refused honestly"
  }
  const key = fixtures.streamKey === undefined ? fixtures.chat : await fixtures.streamKey()
  const base = marker("stream")
  const drafts = [`${base} 1`, `${base} 1 2`, `${base} 1 2 3`]
  for (const text of drafts) {
    const sent = await adapter.send({ op: "stream_draft", key, draft_id: DRAFT_ID, text, final: false })
    expect(sent.message_id === "", `the draft "${text}" returned message_id ${sent.message_id}: a draft must not post a message`)
  }
  const finalText = `${base} final`
  const final = await adapter.send({ op: "stream_draft", key, draft_id: DRAFT_ID, text: finalText, final: true })
  expect(final.message_id !== "", "the final stream_draft returned an empty message_id")
  const view = await fixtures.readMessage(key, final.message_id)
  expect(view !== null && view.text.includes(finalText), `the platform shows "${view?.text ?? "nothing"}" for the final message, expected ${finalText}`)
  expect(fixtures.readDrafts !== undefined, "the adapter claims draft_stream but fixtures.readDrafts is missing, so the drafts cannot be checked")
  const shown = (await fixtures.readDrafts(key, DRAFT_ID)).filter((text) => text.includes(base))
  expect(JSON.stringify(shown) === JSON.stringify(drafts), `streamed drafts [${drafts.join(" | ")}], the platform showed [${shown.join(" | ")}]`)
  return `${drafts.length} drafts in order, then one final message`
}
