import type { SurfaceAdapter, SurfaceKey, UploadFile } from "../contract"

/** What the platform shows for one message, as the conformance suite needs to see it. */
export type PlatformMessageView = { text: string; reactions: readonly string[] }

/**
 * The bridge between the conformance suite and the platform the adapter talks to (normally the
 * adapter author's local fake server). Every method acts on the platform directly, never through
 * the adapter under test.
 */
export type ConformanceFixtures = {
  /** a chat (thread_id null) the adapter may post in and humans can post in */
  chat: SurfaceKey
  /** make a human (non-bot) message with `text` appear at `key`; resolves once the platform accepted it */
  humanPost(input: { key: SurfaceKey; text: string }): Promise<void>
  /**
   * The message as the platform shows it, or null when no message with that id lives exactly at
   * `key` (same chat and same thread_id). `text` is the plain rendering; `reactions` are the gateway
   * reaction names the gateway account currently has on it.
   */
  readMessage(key: SurfaceKey, message_id: string): Promise<PlatformMessageView | null>
  /** titles of the files uploaded at `key`, in the order the platform shows them */
  readUploads(key: SurfaceKey): Promise<readonly string[]>
  /** the texts the platform showed as draft `draft_id` at `key`, in order; required when the adapter claims `draft_stream` */
  readDrafts?(key: SurfaceKey, draft_id: string): Promise<readonly string[]>
  /**
   * Where `stream_draft_honest` streams, for a platform that streams only inside a thread: make a
   * human message in `chat` and return the key of its thread. Default: `chat` itself.
   */
  streamKey?(): Promise<SurfaceKey>
  /** two or more files the upload check may send; without them the check is skipped */
  files?: readonly UploadFile[]
  /** bound on every wait for an inbound event; default 5000 ms */
  timeoutMs?: number
}

export type MakeAdapter = () => SurfaceAdapter | Promise<SurfaceAdapter>

export type CheckId =
  | "capabilities_shape"
  | "event_id_unique"
  | "dedupe_on_replay"
  | "edit_own_message"
  | "reaction_swap"
  | "upload_ordering"
  | "thread_reply_placement"
  | "create_chat"
  | "stream_draft_honest"
  | "capability_refusals"

export type CheckResult = { id: CheckId; status: "pass" | "fail" | "skip"; detail: string }

export type ConformanceReport = { platform: string; ok: boolean; checks: readonly CheckResult[] }

/** Thrown by a check to fail with a readable message. */
export class ConformanceFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConformanceFailure"
  }
}

/** Returned by a check that does not apply to the adapter's capabilities. */
export class ConformanceSkip {
  constructor(readonly reason: string) {}
}

export type CheckContext = {
  makeAdapter: MakeAdapter
  fixtures: ConformanceFixtures
  timeoutMs: number
  /** a unique marker text per call, so checks never confuse their messages with others */
  marker(label: string): string
}

export type Check = (context: CheckContext) => Promise<string | ConformanceSkip>
