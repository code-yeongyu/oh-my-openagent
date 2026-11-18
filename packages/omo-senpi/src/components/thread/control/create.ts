import { toThreadAddressEntries } from "../address-book"
import { checkNameConflict } from "../addressing"
import type {
  ThreadCreateInput,
  ThreadCreatePrompt,
  ThreadCreateResult,
  ThreadSendResult,
  ThreadSummary,
  ThreadToolResult,
} from "../contracts"
import { threadToolFailure, type ThreadErrorCode } from "../errors"
import type { DeliveryTarget } from "../gateway/transport"
import { checkInitialSkills } from "../initial-skills"
import { createdDeviceRow } from "../remote/address-book"
import type { LocalExisting } from "../remote/cross-device"
import { claimCreatedAlias, planCreate, withAlias } from "../remote/lazy-ops"
import { threadLink } from "../thread-link"
import { recordThreadCreator } from "../tools/extension-tools"
import {
  failure,
  resolution,
  resolveAcross,
  resolveEntries,
  sendAddressBook,
  summary,
  targetSession,
  uncertainFailure,
} from "../tools/internals"
import type { ThreadHostView, ThreadToolSurfaceOptions } from "../tools/ports"
import { openedResult } from "../tools/thread-row"
import { createLaunch } from "./create-launch"
import { createLocalSessionHost, workspaceNote } from "./local-session-host"
import { locateControl } from "./locate"
import { controlRefusalOf } from "./port"
import { createdThreadId, type HostedThread, type SessionOpenOutcome } from "./session-host"

/** The longest untyped rename error kept as `local_name_unavailable_reason`, in code points; longer ones end in an ellipsis. */
const RENAME_REASON_MAX_CHARS = 300

/** A create's first prompt as the one send path takes it. */
export type CreatePromptSend = {
  readonly thread: string
  readonly message: string
  readonly delivery?: ThreadCreateInput["delivery"]
}

/** What a create needs from the surface that runs it (the agent tools or the thread SDK). */
export type CreateContext = {
  /** The call's idempotency key: a new thread on this device is created under an id derived from it (#14060). */
  readonly operationId: string
  readonly callerId: string
  /** Set when an earlier run under this key failed after it may have made a thread (#14060). */
  readonly retrying?: { readonly error_note: string | null } | undefined
  /** A fresh host view, for finding again a thread this create already made. */
  readonly view: () => Promise<ThreadHostView>
  /** Sends the first prompt to the thread the create made, as the surface's own sender, with the creator's authority. */
  readonly deliverPrompt: (
    current: ThreadHostView,
    target: DeliveryTarget,
    send: CreatePromptSend,
    idempotencyKey: string,
  ) => Promise<ThreadToolResult>
}

/**
 * The one create body (thread_create and the SDK) for a new, an existing or a forked thread, here or on another device
 * (#12884): the shape checks, then placement (the only step that reads the device), then the name checked against the
 * threads the target device sees, then one open through the SessionHost - a created or forked session starting in its
 * creator's approval mode on either device - then the creator record, the alias, and the first prompt. An existing
 * thread that is live already is answered from placement (`deduplicated`), so no second open reaches it anywhere.
 */
export async function createThread(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  value: ThreadCreateInput,
  context: CreateContext,
): Promise<ThreadToolResult> {
  const { operationId, callerId, retrying, view } = context
  const launch = createLaunch(value, options.remote?.permissionPreset?.())
  if ("kind" in launch) return launch
  // #14050: a new thread with no first prompt and no name is an empty session nobody asked for; refuse it as data.
  const named = (value.name?.trim() ?? "") !== "" || (value.alias?.trim() ?? "") !== ""
  if (value.thread === undefined && value.fork_from === undefined && value.prompt === undefined && !named)
    return failure(
      "invalid_arguments",
      "thread_create (tool.thread_create() in an eval cell) makes a new thread only with a prompt or a name; neither was given, so nothing was created.",
      "Pass prompt (the new thread's first message) or name, or pass thread to open an existing thread.",
    )
  // #14060: an earlier run under this key failed after it may have made a thread. It is re-run only when the thread
  // the key derives is on this device; otherwise (a create on another device, a host that ignored the derived id)
  // a thread may exist that nothing here can find, so the retry is refused as any other uncertain operation is.
  if (retrying !== undefined) {
    const derived = existingHere(options, current, createdThreadId(callerId, operationId), callerId)
    if (derived.kind !== "live" && derived.kind !== "file") return uncertainFailure(retrying.error_note)
  }
  // The session the open answered, with its listing key: a first prompt to a thread on another device needs it.
  let opened: HostedThread | undefined
  const made = await (async (): Promise<ThreadToolResult> => {
    const skills =
      value.skills === undefined || value.skills.length === 0 ? undefined : checkInitialSkills(value.skills)
    if (skills?.kind === "invalid")
      return failure(
        "invalid_arguments",
        `Not a skill name: ${skills.names.join(", ")}. Pass the names of installed skills, never a path or text.`,
        "Pass skill names as listed by the skill index.",
        { invalid: skills.names },
      )
    const loaded = skills?.kind === "ok" ? skills.names : undefined
    const entries = resolveEntries(options, current)
    const callerCwd = options.callerWorkspaceRoot()
    const plan = await planCreate(options.remote, value, {
      host: createLocalSessionHost(options.host, entries),
      ...(callerCwd.trim() === "" ? {} : { callerCwd }),
      resolve: (address) => resolution(options, entries, address, callerId, true),
      // Decision 0027: an existing thread or a fork source is found by the same resolver every send uses, not by a second ladder.
      locate: async (address) => {
        // #14049: an existing thread whose process exited is still this device's when its session file is here, so
        // the ladder sees the files an id or name names (the send address book), and an id nothing lists is looked
        // up once on every online device of the account (A4.3.3), as a send to that id is.
        const known = toThreadAddressEntries(sendAddressBook(options, current, address, true))
        const found = await resolveAcross(options, known, address, callerId, true, "exact", true)
        if (found.kind === "error")
          return { kind: "error", result: { kind: "error", error: found } as ThreadToolResult }
        // A row with no file path (a probe's ended row, a snapshot, a session listed before its file existed) has its
        // file found on its device by placement, whatever its state (#14170); it is never opened by an empty path.
        return found.entry.transport?.kind === "relay"
          ? { kind: "remote", row: found.entry.transport.row }
          : { kind: "local", address: found.entry.thread_id, accountWide: true }
      },
      existing: (address) => existingHere(options, current, address, callerId),
    })
    if (plan.kind === "done") return await withAlias(options.remote, value.alias, plan.result, plan.device)
    // An alias no account holds names the thread on its device instead (#13104); a given name wins.
    // Trimmed like thread_rename's alias-as-name, so " x " and "x" name the thread the same way.
    const name = plan.localAlias === undefined ? value.name : (value.name ?? value.alias?.trim())
    // #14060: a new thread on this device is created under an id derived from this call's idempotency key, so a
    // create whose reply was lost (the connection closed after the host made the session) is found again: on the
    // spot, and by a retry under the same key, which reopens or reuses that thread and admits its prompt once.
    const createdId =
      plan.creates && plan.host.device === undefined ? createdThreadId(callerId, operationId) : undefined
    const earlier = createdId === undefined ? undefined : existingHere(options, current, createdId, callerId)
    // The thread an earlier run made may already carry this name: it is this create's own thread, not a conflict.
    if (name !== undefined && earlier?.kind !== "live" && earlier?.kind !== "file") {
      const conflict = checkNameConflict(await plan.host.visible(), name)
      if (conflict.kind === "error") return { kind: "error", error: conflict } as ThreadToolResult
    }
    const preset = plan.creates ? launch.permissionPreset : undefined
    const reopened = async (): Promise<SessionOpenOutcome | undefined> => {
      if (createdId === undefined) return undefined
      const found = existingHere(options, await view(), createdId, callerId)
      if (found.kind === "live") return { kind: "ok", thread: found.thread }
      return found.kind === "file" ? await plan.host.open({ sessionPath: found.sessionPath }) : undefined
    }
    let outcome: SessionOpenOutcome
    if (earlier?.kind === "live") outcome = { kind: "ok", thread: earlier.thread }
    else if (earlier?.kind === "file") outcome = await plan.host.open({ sessionPath: earlier.sessionPath })
    else
      try {
        outcome = await plan.host.open({
          ...plan.request,
          ...(plan.creates && name !== undefined ? { name } : {}),
          ...(plan.creates && loaded !== undefined ? { initialSkills: loaded } : {}),
          ...(preset === undefined ? {} : { permissionPreset: preset }),
          ...(plan.creates ? launch.profile : {}),
          ...(createdId === undefined ? {} : { durableSessionId: createdId }),
        })
      } catch (error) {
        const found = await reopened()
        if (found === undefined) throw error
        outcome = found
      }
    if (outcome.kind === "error") return outcome
    opened = outcome.thread
    const created: ThreadToolResult = {
      ...openedResult(outcome.thread, false),
      ...(plan.creates && loaded !== undefined ? { requested_skills: loaded } : {}),
      ...workspaceNote(outcome.thread, callerCwd),
    }
    const recorded = plan.creates ? await recordThreadCreator(options, current, callerId, created) : created
    if (plan.localAlias !== undefined)
      return recorded.kind === "ok"
        ? ({ ...recorded, alias_scope: "local", alias_unavailable: plan.localAlias } as ThreadToolResult)
        : recorded
    if (!plan.creates) return await withAlias(options.remote, value.alias, recorded, plan.host.device)
    const claimed = await claimCreatedAlias(options.remote, value.alias, recorded, plan.host.device)
    if (!("local" in claimed)) return claimed
    // The account was gone by the claim, after the create: the alias names the new thread here, as with no account.
    if (recorded.kind !== "ok" || !("thread" in recorded) || value.alias === undefined) return recorded
    const local = { alias_scope: "local", alias_unavailable: claimed.local } as const
    if (value.name !== undefined) return { ...recorded, ...local } as ThreadToolResult
    const localName = value.alias.trim()
    const nameRefusal = await nameCreatedThread(
      options,
      recorded.thread,
      localName,
      await plan.host.visible(),
      callerId,
      view,
    )
    return (
      nameRefusal === undefined
        ? { ...recorded, name: localName, link: threadLink(recorded.thread, localName), ...local }
        : {
            ...recorded,
            ...local,
            local_name_unavailable: nameRefusal.code,
            ...(nameRefusal.reason === undefined ? {} : { local_name_unavailable_reason: nameRefusal.reason }),
          }
    ) as ThreadToolResult
  })()
  if (value.prompt === undefined || made.kind !== "ok" || opened === undefined) return made
  if ((made as Extract<ThreadCreateResult, { kind: "ok" }>).deduplicated) return made
  return {
    ...made,
    prompt: await firstPrompt(current, opened, value, context),
  } as ThreadToolResult
}

/**
 * Delivers a create's `prompt` to the thread it just made, through the surface's one send path (#13410), under a key
 * derived from the create's own: a replayed create answers its stored result, so the prompt is sent once per key. The
 * target is the created thread itself (its device and durable id), never a lookup by name, so a listing that has not
 * caught up yet cannot answer not_found (#13001).
 */
async function firstPrompt(
  current: ThreadHostView,
  thread: HostedThread,
  value: ThreadCreateInput,
  context: CreateContext,
): Promise<ThreadCreatePrompt> {
  const target: DeliveryTarget =
    thread.device === undefined
      ? { kind: "local", thread_id: thread.thread_id, all_scope: true }
      : { kind: "remote", row: createdDeviceRow(thread.device, thread) }
  const send = {
    thread: thread.thread_id,
    message: value.prompt ?? "",
    ...(value.delivery === undefined ? {} : { delivery: value.delivery }),
  }
  // The thread exists from here on: a delivery that throws (a store or connection failure, not a typed refusal) is the
  // prompt's outcome, never the create's, so the caller still gets the thread it made (review L1 at 0571de8).
  let sent: ThreadToolResult
  try {
    sent = await context.deliverPrompt(current, target, send, `${context.operationId}:prompt`)
  } catch (error) {
    return {
      error: threadToolFailure(
        "internal_error",
        `The thread was created, but its first prompt was not delivered: ${error instanceof Error ? error.message : String(error)}.`,
        `Send it with thread_send to ${thread.thread_id} (tool.thread_send({ thread, message }) in an eval cell); read the thread first if the prompt may have arrived.`,
        { thread: thread.thread_id },
      ),
    }
  }
  if (sent.kind === "error") return { error: sent.error }
  const { delivery, deduplicated, delivery_id, effective_mode } = sent as Extract<ThreadSendResult, { kind: "ok" }>
  return {
    delivery,
    deduplicated,
    ...(delivery_id === undefined ? {} : { delivery_id }),
    ...(effective_mode === undefined ? {} : { effective_mode }),
  }
}

/**
 * Names a thread the create already made, through the same path thread_rename takes (the create's name check against the
 * device's threads, then the located control's setName). Answers the refusing code instead of failing, because the
 * thread exists either way: a rename that fails with no typed refusal answers `host_unavailable` with the error's message
 * as `reason`, so the result still names the created thread (withAlias's rule for every failure after the create) and a
 * failure in the rename path stays traceable.
 */
async function nameCreatedThread(
  options: ThreadToolSurfaceOptions,
  threadId: string,
  name: string,
  visible: readonly ThreadSummary[],
  callerId: string,
  view: () => Promise<ThreadHostView>,
): Promise<{ readonly code: ThreadErrorCode; readonly reason?: string } | undefined> {
  const conflict = checkNameConflict(
    visible.filter((thread) => thread.thread_id !== threadId),
    name,
  )
  if (conflict.kind === "error") return { code: conflict.code }
  const located = await locateControl(options, await view(), threadId, true, callerId)
  if (located.kind === "not_live") return { code: "not_resumable" }
  if (located.kind === "error")
    return { code: located.result.kind === "error" ? located.result.error.code : "host_unavailable" }
  try {
    await located.control.setName(name)
  } catch (error) {
    const refusal = controlRefusalOf(error)
    if (refusal !== undefined) return { code: refusal.code }
    const message = [...(error instanceof Error ? error.message : String(error))]
    // A failed RPC can carry a whole host reply frame (live-surface.ts), and the result is kept in the call's receipt.
    const reason =
      message.length > RENAME_REASON_MAX_CHARS
        ? `${message.slice(0, RENAME_REASON_MAX_CHARS).join("")}…`
        : message.join("")
    return { code: "host_unavailable", reason }
  }
  return undefined
}

/** An existing thread this device is asked to open: live in the view, a session file the address book names, or neither. */
function existingHere(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  address: string,
  callerId: string,
): LocalExisting {
  const book = sendAddressBook(options, current, address, true)
  const resolved = resolution(options, toThreadAddressEntries(book), address, callerId, true)
  if (resolved.kind === "error")
    return { kind: "error", result: { kind: "error", error: resolved } as ThreadToolResult }
  const live = targetSession(current, resolved.entry.thread_id)
  if (live !== undefined) return { kind: "live", thread: summary(live) }
  const entry = book.find((candidate) => candidate.thread_id === resolved.entry.thread_id)
  if (entry?.session_path === undefined || entry.session_path === null)
    return {
      kind: "error",
      result: failure(
        "not_resumable",
        "The thread has no session file on this device to open.",
        "Call thread_list (tool.thread_list() in an eval cell) and pick a thread it lists.",
      ),
    }
  return { kind: "file", sessionPath: entry.session_path }
}
