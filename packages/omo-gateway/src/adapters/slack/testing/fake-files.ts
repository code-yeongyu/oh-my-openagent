import { fail, p, parseBlocks, type MethodContext, type Reply } from "./fake-context"
import type { FakeFile } from "./fake-state"

function completeUpload(ctx: MethodContext): Reply {
  const channel = p(ctx, "channel_id")
  if (!ctx.state.channels.has(channel)) return fail("channel_not_found")
  const listed: unknown = JSON.parse(p(ctx, "files") || "[]")
  if (!Array.isArray(listed) || listed.length === 0) return fail("invalid_arguments")
  const files: FakeFile[] = []
  for (const entry of listed) {
    const file = entry !== null && typeof entry === "object" && "id" in entry ? ctx.state.files.get(String(entry.id)) : undefined
    if (file === undefined || file.bytes.byteLength === 0) return fail("file_not_found")
    file.title = "title" in entry && typeof entry.title === "string" ? entry.title : file.name
    files.push(file)
  }
  const blocks = parseBlocks(p(ctx, "blocks"))
  if (blocks === "invalid") return fail("invalid_blocks")
  const thread = p(ctx, "thread_ts")
  const message = ctx.state.add({ channel, user: ctx.caller.user, bot_id: ctx.caller.bot_id, text: p(ctx, "initial_comment"), blocks, subtype: "file_share", files, thread_ts: thread === "" ? null : thread })
  for (const file of files) file.shared = { channel, ts: message.ts }
  return { ok: true, files: files.map((file) => ({ id: file.id, title: file.title })) }
}

/** The external upload flow: getUploadURLExternal -> POST bytes -> one completeUploadExternal -> files.info shares. */
export function fileMethod(method: string, ctx: MethodContext): Reply {
  const { state } = ctx
  switch (method) {
    case "files.getUploadURLExternal": {
      const id = state.nextId("F")
      state.files.set(id, { id, name: p(ctx, "filename"), title: p(ctx, "filename"), mimetype: "text/plain", bytes: new Uint8Array(), subtype: null, shared: null })
      return { ok: true, upload_url: `${ctx.origin}/upload/${id}`, file_id: id }
    }
    case "files.completeUploadExternal":
      return completeUpload(ctx)
    case "files.info": {
      const file = state.files.get(p(ctx, "file"))
      if (file === undefined) return fail("file_not_found")
      const hidden = file.shared !== null && ctx.counters.hiddenShares > 0
      if (hidden) ctx.counters.hiddenShares -= 1
      const shares = file.shared === null || hidden ? {} : { public: { [file.shared.channel]: [{ ts: file.shared.ts }] } }
      return { ok: true, file: { id: file.id, title: file.title, permalink: `${ctx.origin}/files/${file.id}/permalink`, shares } }
    }
    default:
      return fail("unknown_method")
  }
}
