// `upload` on Slack: stage every file (files.getUploadURLExternal, then the bytes), complete them in
// one files.completeUploadExternal, then find the message the share made through files.info. Slack
// shares asynchronously, so files.info may answer before the share exists: it is re-read with a
// bounded backoff on the adapter clock. When the share never shows up within that budget, the
// result's `message_id` is the first file id (`F...`) instead of a message ts, the permalink is the
// file's own, and one log line says so; an edit or reaction on that id is refused by Slack.
import { AdapterFatal, AdapterRefusal, type RichBody, type SendResult, type SurfaceKey, type UploadFile } from "../../adapter/contract"
import { SlackApiError, type SlackApi } from "./api"
import type { ChannelTokenBucket } from "./bucket"
import type { SlackClock } from "./clock"
import { richBlocks } from "./render"
import { isJson, isTs, type Json } from "./wire"

/** files.info attempts after the upload completes, and the first wait between them (doubled each time) */
export const SHARE_LOOKUP = { attempts: 5, firstDelayMs: 500 } as const

export type UploadDeps = {
  api: SlackApi
  bucket: ChannelTokenBucket
  clock: SlackClock
  log: (line: string) => void
  result(key: SurfaceKey, ts: string): Promise<SendResult>
}

async function stage(api: SlackApi, file: UploadFile): Promise<string> {
  const bytes = await Bun.file(file.path).bytes()
  const filename = file.path.split("/").pop() ?? file.title
  const slot = await api.call("files.getUploadURLExternal", { filename, length: bytes.byteLength })
  if (typeof slot.upload_url !== "string" || typeof slot.file_id !== "string") throw new SlackApiError("files.getUploadURLExternal", "ok without upload_url/file_id")
  await api.uploadBytes(slot.upload_url, bytes)
  return slot.file_id
}

function sharedIn(file: Json | null, channel: string): string | null {
  const shares = file !== null && isJson(file.shares) ? file.shares : null
  for (const scope of ["public", "private"]) {
    const byChannel = shares !== null && isJson(shares[scope]) ? shares[scope] : null
    const list = byChannel !== null ? byChannel[channel] : null
    const first: unknown = Array.isArray(list) ? list[0] : null
    if (isJson(first) && isTs(first.ts)) return first.ts
  }
  return null
}

async function fileInfo(api: SlackApi, file_id: string): Promise<Json | null> {
  try {
    const info = await api.call("files.info", { file: file_id })
    return isJson(info.file) ? info.file : null
  } catch (error) {
    if (error instanceof AdapterFatal) throw error
    return null
  }
}

async function shareOrFallback(deps: UploadDeps, key: SurfaceKey, file_id: string): Promise<SendResult> {
  let delay: number = SHARE_LOOKUP.firstDelayMs
  let file: Json | null = null
  for (let attempt = 1; attempt <= SHARE_LOOKUP.attempts; attempt += 1) {
    file = await fileInfo(deps.api, file_id)
    const ts = sharedIn(file, key.chat_id)
    if (ts !== null) return deps.result(key, ts)
    if (attempt < SHARE_LOOKUP.attempts) {
      await deps.clock.sleep(delay)
      delay *= 2
    }
  }
  deps.log(`slack upload ${file_id}: files.info showed no share in ${key.chat_id} after ${SHARE_LOOKUP.attempts} reads; returning the file id as message_id`)
  const permalink = file !== null && typeof file.permalink === "string" ? file.permalink : ""
  return { message_id: file_id, permalink, created: null }
}

export async function uploadFiles(deps: UploadDeps, key: SurfaceKey, files: readonly UploadFile[], comment: RichBody | null): Promise<SendResult> {
  if (files.length === 0) throw new AdapterRefusal("upload", "uploads", "upload carries no files")
  const ids: string[] = []
  for (const file of files) ids.push(await stage(deps.api, file))
  await deps.bucket.take(key.chat_id)
  await deps.api.call("files.completeUploadExternal", {
    files: JSON.stringify(files.map((file, index) => ({ id: ids[index], title: file.title }))),
    channel_id: key.chat_id,
    thread_ts: key.thread_id ?? undefined,
    blocks: comment === null ? undefined : JSON.stringify(richBlocks(comment)),
  })
  const [first] = ids
  if (first === undefined) throw new AdapterRefusal("upload", "uploads", "upload carries no files")
  return shareOrFallback(deps, key, first)
}
