import { describe, expect, test } from "bun:test"
import { toInboundDrafts, type BotIdentity } from "./inbound"
import { reactionEmoji, reactionName } from "./reactions"
import { renderTelegramHtml } from "./render"
import { parseUpdate } from "./wire"

const bot: BotIdentity = { id: 7000000001, username: "omo_qa_bot" }
const group = { id: -1000000000001, type: "supergroup", username: "qa_group" }
const alice = { id: 1000000001, is_bot: false, first_name: "Alice", last_name: "Test" }

function drafts(raw: unknown) {
  const update = parseUpdate(raw)
  if (update === null) throw new Error("unparsed")
  return toInboundDrafts(update, String(bot.id), bot).map((draft) => draft.event)
}

describe("kind classification", () => {
  test("private chats are dm; @bot and replies to the bot are mention; topic messages are thread_reply; others channel", () => {
    expect(drafts({ update_id: 1, message: { message_id: 1, date: 1, chat: { id: alice.id, type: "private" }, from: alice, text: "hi" } })[0]?.kind).toBe("dm")
    const mention = { message_id: 2, date: 1, chat: group, from: alice, text: "hey @OMO_QA_BOT look", entities: [{ type: "mention", offset: 4, length: 11 }] }
    expect(drafts({ update_id: 2, message: mention })[0]?.kind).toBe("mention")
    const reply = { message_id: 3, date: 1, chat: group, from: alice, text: "yes", reply_to_message: { message_id: 1, date: 1, chat: group, from: { ...bot, is_bot: true, first_name: "QA Bot" }, text: "question?" } }
    expect(drafts({ update_id: 3, message: reply })[0]).toMatchObject({ kind: "mention", reply_to: { message_id: "1", text: "question?" } })
    expect(drafts({ update_id: 4, message: { message_id: 4, date: 1, chat: group, from: alice, text: "t", message_thread_id: 9, is_topic_message: true } })[0]).toMatchObject({ kind: "thread_reply", key: { thread_id: "9" } })
    expect(drafts({ update_id: 5, message: { message_id: 5, date: 1, chat: group, from: alice, text: "c", message_thread_id: 3 } })[0]).toMatchObject({ kind: "channel", key: { thread_id: null } })
  })

  test("event ids are chat-scoped and stable; edits get their own id per edit time", () => {
    const message = { message_id: 8, date: 100, chat: group, from: alice, text: "v1" }
    const [original] = drafts({ update_id: 10, message })
    const [again] = drafts({ update_id: 10, message })
    const [edit] = drafts({ update_id: 11, edited_message: { ...message, text: "v2", edit_date: 200 } })
    expect(original?.event_id).toBe(`${group.id}:8`)
    expect(again?.event_id).toBe(original?.event_id)
    expect(edit).toMatchObject({ kind: "edit", edited: { object_id: "8", field: "text" }, event_id: `${group.id}:8:edit:200`, text: "v2" })
    expect(original?.permalink).toBe("https://t.me/qa_group/8")
  })

  test("bot authors are marked is_bot; service messages and unknown updates yield nothing", () => {
    expect(drafts({ update_id: 1, message: { message_id: 1, date: 1, chat: group, from: { ...alice, is_bot: true }, text: "beep" } })[0]?.author.is_bot).toBe(true)
    expect(drafts({ update_id: 2, message: { message_id: 2, date: 1, chat: group, from: alice, new_chat_members: [] } })).toEqual([])
    expect(drafts({ update_id: 3, callback_query: {} })).toEqual([])
    expect(parseUpdate({ message: {} })).toBeNull()
    expect(parseUpdate("garbage")).toBeNull()
  })

  test("only newly added reactions become events", () => {
    const events = drafts({
      update_id: 6,
      message_reaction: { chat: group, message_id: 4, user: alice, date: 5, old_reaction: [{ type: "emoji", emoji: "\u{1F440}" }], new_reaction: [{ type: "emoji", emoji: "\u{1F440}" }, { type: "emoji", emoji: "\u{1F44D}" }] },
    })
    expect(events.map((event) => event.reaction?.name)).toEqual(["done"])
  })
})

describe("rendering", () => {
  test("HTML escapes text and attributes, links bold spans, and links numeric mentions", () => {
    const html = renderTelegramHtml([
      { t: "text", text: "a<b & c", bold: true },
      { t: "link", url: 'https://x.test/?q="1"&r=2', label: "L<1>", bold: true },
      { t: "mention", platform_user_id: "1000000001", display: "Alice" },
      { t: "mention", platform_user_id: "someone" },
      { t: "channel", chat_id: "-100", display: "ops" },
    ])
    expect(html).toBe('<b>a&lt;b &amp; c</b><b><a href="https://x.test/?q=&quot;1&quot;&amp;r=2">L&lt;1&gt;</a></b><a href="tg://user?id=1000000001">@Alice</a>@someone#ops')
  })

  test("gateway reaction names round-trip; unmappable names are null; raw emoji pass through", () => {
    for (const name of ["seen", "working", "done", "failed", "waiting", "question"]) {
      const emoji = reactionEmoji(name)
      expect(emoji === null ? null : reactionName(emoji)).toBe(name)
    }
    expect(reactionEmoji("number_3")).toBeNull()
    expect(reactionEmoji("\u{1F525}")).toBe("\u{1F525}")
  })
})
