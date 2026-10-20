import { MAX_SESSION_DIGEST_BYTES } from "./constants"
import type { TranscriptRecord } from "./transcript-records"
import type { AgentSessionThread, SessionDigest, SessionToolUse } from "./types"

const FIRST_REQUEST_CHARS = 1500
const OUTCOME_CHARS = 1000
const MAX_TOOLS = 24
const MAX_FILES = 32
const MAX_PATH_CHARS = 200

const encoder = new TextEncoder()
export const digestByteLength = (digest: SessionDigest): number => encoder.encode(JSON.stringify(digest)).byteLength

function clip(text: string, limit: number): { readonly text: string; readonly clipped: boolean } {
  const trimmed = text.trim()
  return trimmed.length <= limit ? { text: trimmed, clipped: false } : { text: `${trimmed.slice(0, limit - 1)}…`, clipped: true }
}

function summarizeTools(records: ReadonlyArray<TranscriptRecord>) {
  const counts = new Map<string, number>()
  const files: Array<string> = []
  for (const record of records) {
    for (const tool of record.tools ?? []) {
      counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1)
      for (const file of tool.changedFiles) if (!files.includes(file)) files.push(file)
    }
  }
  const tools: Array<SessionToolUse> = Array.from(counts, ([name, count]) => ({ name, count })).sort(
    (left, right) => right.count - left.count || left.name.localeCompare(right.name),
  )
  return { tools, files }
}

/**
 * A bounded, local-only summary of one session: the first request, the tools used, the files changed and
 * the last assistant answer. Lists are cut first, then the two texts, until the JSON fits the byte cap.
 */
export function buildSessionDigest(input: {
  readonly thread: AgentSessionThread
  readonly records: ReadonlyArray<TranscriptRecord>
  readonly cwd: string
}): SessionDigest {
  const { thread } = input
  const firstUser = thread.messages.find((message) => message.role === "user")
  const lastAssistant = thread.messages.findLast((message) => message.role === "assistant")
  const request = clip(firstUser?.text ?? "", FIRST_REQUEST_CHARS)
  const outcome = clip(lastAssistant?.text ?? "", OUTCOME_CHARS)
  const summary = summarizeTools(input.records)
  const files = summary.files.slice(0, MAX_FILES).map((file) => clip(file, MAX_PATH_CHARS).text)
  let digest: SessionDigest = {
    sessionKey: `${thread.source}:${thread.providerSessionId}`,
    source: thread.source,
    providerSessionId: thread.providerSessionId,
    cwd: input.cwd,
    title: thread.title,
    model: thread.model,
    startedAt: thread.createdAt,
    lastActiveAt: thread.updatedAt,
    messageCount: thread.messages.length,
    firstRequest: request.text,
    toolsUsed: summary.tools.slice(0, MAX_TOOLS),
    filesChanged: files,
    outcome: outcome.text,
    truncated:
      request.clipped || outcome.clipped || summary.tools.length > MAX_TOOLS || summary.files.length > MAX_FILES,
  }
  while (digestByteLength(digest) > MAX_SESSION_DIGEST_BYTES) {
    if (digest.filesChanged.length > 0) digest = { ...digest, filesChanged: digest.filesChanged.slice(0, -1) }
    else if (digest.toolsUsed.length > 0) digest = { ...digest, toolsUsed: digest.toolsUsed.slice(0, -1) }
    else if (digest.firstRequest.length >= digest.outcome.length && digest.firstRequest.length > 0)
      digest = { ...digest, firstRequest: clip(digest.firstRequest, Math.floor(digest.firstRequest.length * 0.9)).text }
    else if (digest.outcome.length > 0) digest = { ...digest, outcome: clip(digest.outcome, Math.floor(digest.outcome.length * 0.9)).text }
    else digest = { ...digest, title: clip(digest.title, Math.floor(digest.title.length * 0.9)).text, cwd: clip(digest.cwd, MAX_PATH_CHARS).text }
    digest = { ...digest, truncated: true }
  }
  return digest
}
