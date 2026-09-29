import type { RichBody, SurfaceKey } from "../contract"
import { ConformanceSkip, type Check } from "./types"
import { collectInbound, expect, expectRefusal } from "./wait"

const text = (value: string): RichBody => [{ t: "text", text: value }]

export const editOwnMessage: Check = async ({ makeAdapter, fixtures, marker }) => {
  const adapter = await makeAdapter()
  const before = marker("edit-before")
  const after = marker("edit-after")
  const posted = await adapter.send({ op: "post", key: fixtures.chat, body: text(before) })
  expect(posted.message_id !== "", "post returned an empty message_id")
  if (!adapter.capabilities().edit) {
    await expectRefusal(() => adapter.send({ op: "edit", key: fixtures.chat, message_id: posted.message_id, body: text(after) }), ["edit"], "edit")
    return "edit is false; the edit op was refused honestly"
  }
  const edited = await adapter.send({ op: "edit", key: fixtures.chat, message_id: posted.message_id, body: text(after) })
  expect(edited.message_id === posted.message_id, `edit returned message_id ${edited.message_id}, the post was ${posted.message_id}`)
  const view = await fixtures.readMessage(fixtures.chat, posted.message_id)
  expect(view !== null, `the platform has no message ${posted.message_id} after the edit`)
  expect(view.text.includes(after) && !view.text.includes(before), `the platform shows "${view.text}" after editing to ${after}`)
  return "post then edit changed the same message in place"
}

export const reactionSwap: Check = async ({ makeAdapter, fixtures, marker }) => {
  const adapter = await makeAdapter()
  const posted = await adapter.send({ op: "post", key: fixtures.chat, body: text(marker("reaction")) })
  const key = fixtures.chat
  const message_id = posted.message_id
  if (!adapter.capabilities().reactions) {
    await expectRefusal(() => adapter.send({ op: "react", key, message_id, name: "working" }), ["reactions"], "react")
    return "reactions is false; the react op was refused honestly"
  }
  await adapter.send({ op: "react", key, message_id, name: "working" })
  await adapter.send({ op: "unreact", key, message_id, name: "working" })
  await adapter.send({ op: "react", key, message_id, name: "done" })
  const view = await fixtures.readMessage(key, message_id)
  expect(view !== null, `the platform has no message ${message_id}`)
  expect(view.reactions.length === 1 && view.reactions[0] === "done", `after swapping working -> done the message shows [${view.reactions.join(", ")}]`)
  return "working -> done leaves exactly one status reaction"
}

export const uploadOrdering: Check = async ({ makeAdapter, fixtures }) => {
  const adapter = await makeAdapter()
  const files = fixtures.files ?? []
  if (!adapter.capabilities().uploads) {
    await expectRefusal(() => adapter.send({ op: "upload", key: fixtures.chat, files, comment: null }), ["uploads"], "upload")
    return "uploads is false; the upload op was refused honestly"
  }
  if (files.length < 2) return new ConformanceSkip("fixtures.files has fewer than two files")
  const before = (await fixtures.readUploads(fixtures.chat)).length
  await adapter.send({ op: "upload", key: fixtures.chat, files, comment: text("files") })
  const shown = (await fixtures.readUploads(fixtures.chat)).slice(before)
  const wanted = files.map((file) => file.title)
  expect(JSON.stringify(shown) === JSON.stringify(wanted), `uploaded [${wanted.join(", ")}], the platform shows [${shown.join(", ")}]`)
  return `${files.length} files arrived in order`
}

export const threadReplyPlacement: Check = async ({ makeAdapter, fixtures, timeoutMs, marker }) => {
  const adapter = await makeAdapter()
  if (!adapter.capabilities().threads) {
    await expectRefusal(() => adapter.send({ op: "open_thread", key: fixtures.chat, root: text("root") }), ["threads"], "open_thread")
    return "threads is false; open_thread was refused honestly"
  }
  const opened = await adapter.send({ op: "open_thread", key: fixtures.chat, root: text(marker("thread-root")) })
  const thread: SurfaceKey | null = opened.created
  expect(thread !== null && thread.thread_id !== null, "open_thread returned no created key with a thread_id")
  expect(thread.chat_id === fixtures.chat.chat_id, `open_thread created the thread in chat ${thread.chat_id}, not ${fixtures.chat.chat_id}`)
  const reply = await adapter.send({ op: "post", key: thread, body: text(marker("thread-reply")) })
  expect((await fixtures.readMessage(thread, reply.message_id)) !== null, "a post to the thread key is not in the thread")
  expect((await fixtures.readMessage(fixtures.chat, reply.message_id)) === null, "a post to the thread key landed at the top level of the chat")
  const human = marker("thread-human")
  const seen = await collectInbound(adapter, [human], () => fixtures.humanPost({ key: thread, text: human }), timeoutMs)
  const event = seen.get(human)?.[0]
  expect(event?.key.thread_id === thread.thread_id, `a human reply in the thread arrived with thread_id ${event?.key.thread_id}`)
  return "open_thread, reply placement and inbound thread_id agree"
}

export const createChat: Check = async ({ makeAdapter, fixtures, marker }) => {
  const adapter = await makeAdapter()
  if (!adapter.capabilities().chat_create) return new ConformanceSkip("chat_create is false (refusal covered by capability_refusals)")
  const { platform, account_id } = fixtures.chat
  const result = await adapter.send({ op: "create_chat", key: { platform, account_id }, name: marker("chat"), kind: "channel" })
  const chat = result.created
  expect(chat !== null && chat.chat_id !== "" && chat.thread_id === null, `create_chat returned created ${JSON.stringify(chat)}`)
  const posted = await adapter.send({ op: "post", key: chat, body: text(marker("in-new-chat")) })
  expect((await fixtures.readMessage(chat, posted.message_id)) !== null, "a post to the created chat is not visible there")
  return `created chat ${chat.chat_id} and posted in it`
}
