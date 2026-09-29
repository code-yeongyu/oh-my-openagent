import type { ConformanceFixtures } from "../../../adapter/conformance/types"
import type { UploadFile } from "../../../adapter/contract"
import { reactionName } from "../render"
import type { FakeSlackServer } from "./fake-server"
import { FAKE_BOT_USER, FAKE_CHAT, FAKE_SELF, FAKE_TEAM } from "./fake-state"

/** Conformance fixtures that act on the fake Slack server directly, never through the adapter. */
export function slackFixtures(server: FakeSlackServer, files: readonly UploadFile[], account_id = FAKE_TEAM): ConformanceFixtures {
  const self = new Set([FAKE_SELF, FAKE_BOT_USER])
  return {
    chat: server.chat(account_id),
    humanPost: async ({ key, text }) => {
      server.humanPost({ channel: key.chat_id, text, ...(key.thread_id === null ? {} : { thread_ts: key.thread_id }) })
    },
    readMessage: async (key, message_id) => {
      const message = server.at(key).find((m) => m.ts === message_id)
      if (message === undefined) return null
      const reactions = [...message.reactions.entries()].filter(([, users]) => [...users].some((user) => self.has(user))).map(([name]) => reactionName(name))
      return { text: server.state.plain(message), reactions }
    },
    readUploads: async (key) => server.at(key).flatMap((m) => m.files.map((file) => file.title)),
    readDrafts: async (key) => server.at(key).flatMap((m) => server.state.drafts.get(m.ts) ?? []),
    streamKey: async () => {
      const root = server.humanPost({ channel: FAKE_CHAT, text: "a question the stream answers" })
      return { ...server.chat(account_id), thread_id: root.ts }
    },
    files,
    timeoutMs: 5000,
  }
}
