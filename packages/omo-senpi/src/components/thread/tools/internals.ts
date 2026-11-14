import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import type { ThreadResolveResult } from "../addressing"
import { relayAddressBook, relayAddressEntry, type RelayAddressBook } from "../remote/address-book"
import { endedRow, rowThreadId, type RemoteSessionRow } from "../remote/ports"
import { remoteAvailable } from "../remote/remote-ops"
import {
  assembleAddressBook,
  findDiskSessions,
  toThreadAddressEntries,
  type AddressEndpoint,
  type AddressEntry,
  type DiskSession,
  type ThreadSurface,
} from "../address-book"
import {
  fuzzyContenders,
  fuzzyMatch,
  resolveTarget,
  workspaceDirectories,
  workspaceEntries,
  type ThreadAddressEntry,
} from "../addressing"
import type { ThreadToolName, ThreadToolResult, ThreadTranscriptItem } from "../contracts"
import { threadToolFailure, type ThreadErrorCode } from "../errors"
import { THREAD_TOOL_EXPOSURE, THREAD_TOOL_METADATA } from "../metadata"
import { readSessionFacts, threadTitle } from "../session-facts"
import { threadLink } from "../thread-link"
import {
  UNKNOWN_CALLER,
  type ThreadHostSession,
  type ThreadHostView,
  type ThreadHostViewRequest,
  type ThreadSessionPort,
  type ThreadToolSurfaceOptions,
} from "./ports"
import { sendView } from "./send-view"

// biome-ignore lint/suspicious/noExplicitAny: the tool definitions are heterogeneous by design.
export type AnyTool = ToolDefinition<any, any>
export type ToolOutput = AgentToolResult<{ readonly result: ThreadToolResult }>

export function failure(
  code: ThreadErrorCode,
  message: string,
  next: string,
  details?: Readonly<Record<string, unknown>>,
): ThreadToolResult {
  return { kind: "error", error: threadToolFailure(code, message, next, details) }
}

export function output(result: ThreadToolResult): ToolOutput {
  return { content: [{ type: "text", text: JSON.stringify(result) }], details: { result } }
}

export type ThreadToolSummary = Omit<
  ThreadHostSession,
  "name" | "status" | "createdAt" | "updatedAt" | "created_at" | "updated_at"
> & {
  readonly thread_id: string
  readonly name: string
  readonly status: "live" | "resumable"
  readonly created_at: string
  readonly updated_at: string | null
  readonly endpoint?: AddressEndpoint | null
  readonly surface?: ThreadSurface | null
  readonly alive?: boolean
  /** `[title](omo-thread://v1/<thread_id>)` (`thread-link.ts`): paste it when telling the user about this thread. */
  readonly link: string
}

export type ThreadToolMetadata = {
  readonly name: string
  readonly label: string
  readonly description: string
  readonly exposure: typeof THREAD_TOOL_EXPOSURE
}

export function metadata(name: ThreadToolName): ThreadToolMetadata {
  const entry = THREAD_TOOL_METADATA.find((candidate) => candidate.name === name)
  if (entry === undefined) throw new Error(`missing thread metadata for ${name}`)
  return { name: entry.name, label: entry.label, description: entry.description, exposure: entry.exposure }
}

/**
 * One thread as the tools report it. The address book entry, when there is one, supplies what the
 * endpoint may not report: the real name (else the first user message's opening - never the durable
 * id), the header's creation time and the last entry's time, the endpoint and the surface.
 */
export function summary(session: ThreadHostSession, entry?: AddressEntry): ThreadToolSummary {
  const id = session.durableSessionId ?? session.sessionId
  const {
    name: _name,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    created_at: _created,
    updated_at: _updated,
    ...rest
  } = session
  const created = entry?.created_at ?? session.created_at ?? session.createdAt ?? new Date().toISOString()
  return {
    ...rest,
    thread_id: id,
    name: entry?.title ?? threadTitle(session.name, null) ?? "",
    status: session.status === "closed" ? "resumable" : "live",
    created_at: created,
    updated_at: entry === undefined ? (session.updated_at ?? session.updatedAt ?? created) : entry.updated_at,
    ...(entry === undefined ? {} : { endpoint: entry.endpoint, surface: entry.surface, alive: entry.alive }),
    link: threadLink(id, entry?.title ?? threadTitle(session.name, null)),
  }
}

/**
 * One call's view of the host. A multi-endpoint surface answers it whole (`listView`); a host that
 * reaches one endpoint is that endpoint's listing, exactly as before endpoints were enumerated.
 * With `offline`, an endpoint that does not answer is a host without sessions, never a throw.
 */
export async function hostView(
  options: Omit<ThreadToolSurfaceOptions, "store">,
  request: ThreadHostViewRequest = {},
): Promise<ThreadHostView> {
  if (options.host.listView !== undefined) return await options.host.listView(request)
  let sessions: readonly ThreadHostSession[]
  try {
    sessions = await options.host.listSessions()
  } catch (error) {
    if (request.offline !== true) throw error
    return { sessions: [], hosts: [{ socket: options.host.socket, error }], disk: [] }
  }
  return { sessions, hosts: [{ socket: options.host.socket, list_sessions: { sessions } }], disk: [] }
}

export function addressBook(
  options: Omit<ThreadToolSurfaceOptions, "store">,
  view: ThreadHostView,
  extra: readonly DiskSession[] = [],
): AddressEntry[] {
  return assembleAddressBook(view.hosts, [...(options.diskSessions?.() ?? []), ...view.disk, ...extra], {
    facts: readSessionFacts,
  })
}

/**
 * The address book a send resolves `address` against: the endpoints' entries, plus - only when the
 * address names none of them - the session files on disk it names. A session no endpoint lists (its
 * terminal exited, was killed or stopped before this process saw it) is then still found by id or
 * name; its entry has no endpoint, so the gateway queues the send offline. Ambiguity and scope are
 * judged over the same entries as always. An exact durable id wins over every name, live or on disk:
 * when no endpoint lists the id, its session file is looked up even if a live session's name matches.
 */
export function sendAddressBook(
  options: Omit<ThreadToolSurfaceOptions, "store">,
  view: ThreadHostView,
  address: string,
  allScope?: boolean,
): AddressEntry[] {
  const book = addressBook(options, view)
  const sessionsDirectory = options.sessionsDirectory?.()
  if (sessionsDirectory === undefined || address === "self") return book
  const known = new Set(book.map((entry) => entry.durable_id))
  if (known.has(address)) return book
  const root = options.callerWorkspaceRoot()
  const resolved = resolveTarget(toThreadAddressEntries(book), address, {
    all_scope: allScope,
    callerWorkspaceRoot: root,
  })
  const idOnly = resolved.kind !== "error" || resolved.code !== "not_found"
  const found = findDiskSessions(sessionsDirectory, address, {
    all_scope: allScope,
    workspaceRoots: workspaceDirectories(root),
    id_only: idOnly,
  }).filter((session) => !known.has(session.durable_id))
  return found.length === 0 ? book : addressBook(options, view, found)
}

/**
 * Resolves a session address for a store-only operation (bind, rebind, report, bindings by
 * session) the way a send resolves its target: with nothing live it is a view with no live
 * sessions, not `host_unavailable`, and a session known only from its session file still resolves.
 */
export async function resolveStoredSession(
  options: ThreadToolSurfaceOptions,
  view: (request: ThreadHostViewRequest) => Promise<ThreadHostView>,
  address: string,
  callerId: string,
  allScope?: boolean,
) {
  const current = await sendView(options, address, () => view({ offline: true }))
  return resolution(
    options,
    toThreadAddressEntries(sendAddressBook(options, current, address, allScope)),
    address,
    callerId,
    allScope,
  )
}

/** A thread listed from disk because its endpoint is dead: resumable, addressed by its durable id. */
export function degradedSummary(entry: AddressEntry): ThreadToolSummary & { readonly error_note?: string } {
  return {
    sessionId: entry.durable_id,
    durableSessionId: entry.durable_id,
    ...(entry.session_path === null ? {} : { sessionPath: entry.session_path }),
    ...(entry.source_host === null ? {} : { socket: entry.source_host }),
    cwd: entry.cwd,
    thread_id: entry.thread_id,
    name: entry.title ?? "",
    status: "resumable",
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    endpoint: entry.endpoint,
    surface: entry.surface,
    alive: entry.alive,
    link: threadLink(entry.thread_id, entry.title),
    ...(entry.error_note === undefined ? {} : { error_note: entry.error_note }),
  }
}

export function resolveEntries(options: ThreadToolSurfaceOptions, view: ThreadHostView): ThreadAddressEntry[] {
  return toThreadAddressEntries(addressBook(options, view))
}

/** The per-session methods of the endpoint that listed `session`: routing ids are only unique per endpoint. */
export function sessionPort(options: ThreadToolSurfaceOptions, session: ThreadHostSession): ThreadSessionPort {
  return session.socket !== undefined && options.host.endpoint !== undefined
    ? options.host.endpoint(session.socket)
    : options.host
}

export function resolution(
  options: ThreadToolSurfaceOptions,
  entries: readonly ThreadAddressEntry[],
  target: string,
  callerId: string,
  allScope?: boolean,
) {
  if (target === "self") {
    // UNKNOWN_CALLER stands for an ABSENT identity, so it must never match an entry: a thread
    // that happened to carry it as its durable id would otherwise be renamed or re-modelled by
    // any caller whose host passes no execution context.
    const caller = callerId === UNKNOWN_CALLER ? undefined : entries.find((entry) => entry.thread_id === callerId)
    if (caller === undefined)
      return {
        kind: "error" as const,
        ...threadToolFailure(
          "caller_context_missing",
          "The caller's durable session id is not in the thread address book.",
          "Call thread_list and pass an explicit thread_id, or retry from a session with caller context.",
        ),
      }
    target = caller.thread_id
  }
  return resolveTarget(entries, target, { all_scope: allScope, callerWorkspaceRoot: options.callerWorkspaceRoot() })
}

export function routingId(session: ThreadHostSession): string {
  return session.sessionId
}

/** One role vocabulary for both read paths: engine `toolResult` is `tool`; every other non-chat kind is `system`. */
export function transcriptRole(role: unknown): ThreadTranscriptItem["role"] {
  if (role === "user" || role === "assistant") return role
  return role === "toolResult" ? "tool" : "system"
}

export function targetSession(view: ThreadHostView, durableId: string): ThreadHostSession | undefined {
  return view.sessions.find((session) => (session.durableSessionId ?? session.sessionId) === durableId)
}

/**
 * Amendment A4.3.1 of #13037: an approved reply to a sender whose delivery came from another device resolves on THAT
 * device and nowhere else: its listing row for that id when it lists one (a read of that one device, never the whole
 * account), else one probe of that device, which finds a session it holds but does not run as an `ended` row (A4.2).
 * No row there is not_found naming the device; a probe that got no answer is host_unavailable naming it.
 */
export async function replyOnDevice(
  options: ThreadToolSurfaceOptions,
  sender: { readonly session_id: string; readonly device: string },
): Promise<ThreadResolveResult> {
  const missing = (): ThreadResolveResult =>
    ({
      kind: "error",
      ...threadToolFailure(
        "not_found",
        `The sender ${sender.session_id} is not listed on device ${sender.device}, the device its delivery came from.`,
        "Retry when that session is running on its device, or send to another thread as a normal send.",
        { thread_id: sender.session_id, device: sender.device },
      ),
    }) as ThreadResolveResult
  const remote = options.remote
  if (remote === undefined) return missing()
  const unavailable = await remoteAvailable(remote)
  if (unavailable !== undefined) return { kind: "error", ...unavailable.error } as ThreadResolveResult
  let rows: readonly RemoteSessionRow[]
  try {
    rows = await remote.sessions.sessions({ device: sender.device })
  } catch (error) {
    return {
      kind: "error",
      ...threadToolFailure(
        "host_unavailable",
        "The account's session listing could not be reached.",
        "Retry when the device service is reachable.",
        { reason: error instanceof Error ? error.message : String(error) },
      ),
    } as ThreadResolveResult
  }
  const row = rows.find(
    (candidate) => candidate.device === sender.device && rowThreadId(candidate) === sender.session_id,
  )
  if (row !== undefined) return { kind: "ok", entry: relayAddressEntry(row), resolution: "id" }
  const probed = await remote.sessions.lookup?.(sender.device, sender.session_id)
  if (probed?.kind === "found")
    return {
      kind: "ok",
      entry: relayAddressEntry(endedRow(sender.device, probed.key, sender.session_id)),
      resolution: "id",
    }
  if (probed?.kind === "silent")
    return {
      kind: "error",
      ...threadToolFailure(
        "host_unavailable",
        `Device ${sender.device}, where the sender's delivery came from, did not answer whether it holds ${sender.session_id}.`,
        "Retry when that device answers.",
        { thread_id: sender.session_id, device: sender.device, reason: probed.reason },
      ),
    } as ThreadResolveResult
  return missing()
}

/**
 * Decision 0027: ONE resolver over this device's entries and the relay transport's address book. A local hit never needs
 * the relay. A fuzzy handoff first tries the exact ladder (id, alias, name) over every row, ended remote rows included, so
 * it never lands on a different session than the exact path would; otherwise local, live remote and the ended remote rows
 * that can contend are ranked in ONE comparison, so the runner-up rule covers every candidate. Absent remote setup leaves a local miss unchanged; a configured relay's failed lookup, failing
 * transport state (anything but connected once set up), plan refusal or alias holder's typed failure answers before not_found. An alias or entry on another
 * device is account-wide: the local scope no longer applies to it.
 */
export async function resolveAcross(
  options: ThreadToolSurfaceOptions,
  local: readonly ThreadAddressEntry[],
  address: string,
  callerId: string,
  allScope: boolean | undefined,
  match: "exact" | "fuzzy" = "exact",
  lookup = false,
): Promise<ThreadResolveResult & { readonly all_scope?: boolean | undefined }> {
  if (match === "fuzzy" && allScope !== true && options.callerWorkspaceRoot().trim() === "")
    return {
      kind: "error",
      ...threadToolFailure(
        "caller_context_missing",
        "Scoping a fuzzy handoff needs the caller's workspace root, which this call did not provide.",
        "Set all_scope to search every workspace, or hand off from a session that knows its workspace.",
      ),
    }
  const resolve = (
    entries: readonly ThreadAddressEntry[],
    ranked: readonly ThreadAddressEntry[] = entries,
  ): ThreadResolveResult => {
    const exact = resolution(options, entries, address, callerId, allScope)
    if (match === "exact") return exact
    // Exact first (#13141): an id, alias or name the exact path resolves is the answer, so fuzzy only ranks what exact
    // cannot reach. The caller stays excluded, as the fuzzy scan excludes it: a handoff never targets its own sender.
    if (exact.kind === "ok" && exact.entry.thread_id !== callerId) return exact
    const visible =
      allScope === true
        ? ranked
        : [
            ...workspaceEntries(
              ranked.filter((entry) => entry.transport === undefined),
              options.callerWorkspaceRoot(),
            ),
            ...ranked.filter((entry) => entry.transport !== undefined),
          ]
    const found = fuzzyMatch(
      visible.filter((entry) => entry.thread_id !== callerId),
      address,
    )
    return found.kind === "ok" ? { ...found, resolution: "name" } : found
  }
  const here = resolve(local)
  if (options.remote === undefined || (here.kind === "ok" && here.resolution === "id")) return here
  const book = await relayAddressBook(options.remote, address).catch((error: unknown): RelayAddressBook => ({
    entries: [],
    unavailable: threadToolFailure(
      "host_unavailable",
      "The account's session listing could not be reached.",
      "Retry when the device service is reachable.",
      { reason: error instanceof Error ? error.message : String(error) },
    ),
  }))
  if (book.entries.length === 0 && here.kind === "ok") return here
  // An ended session on another device is resumable: the exact ladder sees every row, and fuzzy ranks it in the same
  // comparison as local and live candidates. Only the ended rows that can contend join that comparison (`fuzzyContenders`):
  // the rest can change no outcome, so a large account's history cannot push a unique match over the 500-candidate cap.
  const all = [...local, ...book.entries]
  const ranked =
    match === "fuzzy"
      ? [
          ...local,
          ...book.entries.filter((entry) => entry.status === "live"),
          ...fuzzyContenders(
            book.entries.filter((entry) => entry.status !== "live"),
            address,
          ),
        ]
      : all
  const across = resolve(all, ranked)
  if (across.kind === "ok")
    return {
      ...across,
      all_scope: across.resolution === "alias" || across.entry.transport !== undefined ? true : allScope,
    }
  if (book.aliasFailure !== undefined) return { kind: "error", ...book.aliasFailure } as ThreadResolveResult
  if (book.unavailable !== undefined && here.kind === "error" && here.code === "not_found")
    return { kind: "error", ...book.unavailable } as ThreadResolveResult
  if (lookup && across.code === "not_found" && SESSION_ID.test(address)) {
    const looked = await lookupAcross(options.remote, address)
    if (looked !== undefined) return looked.kind === "ok" ? { ...looked, all_scope: true } : looked
  }
  return across
}

/** A durable session id: the only address the account-wide lookup of A4.3.3 is made for. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * omo#13037 A4.3.3: a session id that this device and the account listing both miss is looked up with one single-probe
 * query to each ONLINE device of the account other than this one, in parallel (the device service bounds each at 3 s).
 * One device holds it: its ended row. None and every device answered: not_found. None and a device stayed silent:
 * host_unavailable naming it. Several: ambiguous_target naming the devices. Undefined when this device's service makes
 * no single probe: the caller answers as before. Never a background scan; nothing is cached.
 */
async function lookupAcross(
  remote: NonNullable<ThreadToolSurfaceOptions["remote"]>,
  address: string,
): Promise<ThreadResolveResult | undefined> {
  // The capability first, from this device's own connection: with the probe off nothing is read for a lookup and the
  // answer stays today's. A device round that fails leaves today's answer too.
  const probe = remote.sessions.lookup
  if (probe === undefined || (await remote.sessions.canLookup?.().catch(() => false)) !== true) return undefined
  let online: readonly { readonly device: string; readonly online: boolean }[]
  try {
    const here = await remote.sessions.thisDevice()
    online = (await remote.sessions.devices()).filter((device) => device.online && device.device !== here)
  } catch {
    return undefined
  }
  const answers = await Promise.all(
    online.map(async (device) => ({ device: device.device, answer: await probe(device.device, address) })),
  )
  if (answers.some(({ answer }) => answer.kind === "unavailable")) return undefined
  // Found over silent, by choice: one device holding the id is used even when another did not answer within the bound or
  // the client's cap. A device that hangs must not block a send another device can take; the silent one is not asked
  // again, and two copies of one id behind a silent device is the residual A4.3.5 names, never ambiguous_target.
  const holders = answers.flatMap(({ device, answer }) =>
    answer.kind === "found" ? [{ device, key: answer.key }] : [],
  )
  const [only] = holders
  if (holders.length === 1 && only !== undefined)
    return { kind: "ok", entry: relayAddressEntry(endedRow(only.device, only.key, address)), resolution: "id" }
  if (holders.length > 1) {
    const candidates = holders.map((holder) => ({
      id: address,
      name: "",
      cwd: "",
      preview: "",
      updatedAt: null,
      state: "resumable" as const,
      device: holder.device,
    }))
    return {
      kind: "error",
      ...threadToolFailure(
        "ambiguous_target",
        `Session ${address} is held on more than one device; none was picked.`,
        "Address the session on one device with <device>/<session id>.",
        { candidates },
      ),
      candidates,
    } as ThreadResolveResult
  }
  const silent = answers.flatMap(({ device, answer }) => (answer.kind === "silent" ? [device] : []))
  if (silent.length > 0)
    return {
      kind: "error",
      ...threadToolFailure(
        "host_unavailable",
        `No device that answered holds session ${address}, and ${silent.join(", ")} did not answer.`,
        "Retry when that device answers.",
        { thread_id: address, devices: silent },
      ),
    } as ThreadResolveResult
  return {
    kind: "error",
    ...threadToolFailure(
      "not_found",
      `No online device of this account holds session ${address}.`,
      "The session may live on a device that is offline: retry when that device is online, or call thread_list.",
      { thread_id: address },
    ),
  } as ThreadResolveResult
}
