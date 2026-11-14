import { toThreadAddressEntries } from "../address-book"
import { checkNameConflict } from "../addressing"
import type { ThreadCreateInput, ThreadSummary, ThreadToolResult } from "../contracts"
import type { ThreadErrorCode } from "../errors"
import { checkInitialSkills } from "../initial-skills"
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
} from "../tools/internals"
import type { ThreadHostView, ThreadToolSurfaceOptions } from "../tools/ports"
import { createLocalSessionHost } from "./local-session-host"
import { locateControl } from "./locate"
import { controlRefusalOf } from "./port"

/**
 * The one create body (thread_create and the SDK) for a new, an existing or a forked thread, here or on another device
 * (#12884): the shape checks, then placement (the only step that reads the device), then the name checked against the
 * threads the target device sees, then one open through the SessionHost - a created or forked session starting in its
 * creator's approval mode on either device - then the creator record and the alias. An existing thread that is live
 * already is answered from placement (`deduplicated`), so no second open reaches it anywhere. `view` takes a fresh view
 * for naming a thread the create already made.
 */
export async function createThread(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  value: ThreadCreateInput,
  callerId: string,
  view: () => Promise<ThreadHostView>,
): Promise<ThreadToolResult> {
  const skills = value.skills === undefined || value.skills.length === 0 ? undefined : checkInitialSkills(value.skills)
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
      const found = await resolveAcross(options, entries, address, callerId, true)
      if (found.kind === "error") return { kind: "error", result: { kind: "error", error: found } as ThreadToolResult }
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
  if (name !== undefined) {
    const conflict = checkNameConflict(await plan.host.visible(), name)
    if (conflict.kind === "error") return { kind: "error", error: conflict } as ThreadToolResult
  }
  const preset = plan.creates ? options.remote?.permissionPreset?.() : undefined
  const opened = await plan.host.open({
    ...plan.request,
    ...(plan.creates && name !== undefined ? { name } : {}),
    ...(plan.creates && loaded !== undefined ? { initialSkills: loaded } : {}),
    ...(preset === undefined ? {} : { permissionPreset: preset }),
  })
  if (opened.kind === "error") return opened
  const created: ThreadToolResult = {
    kind: "ok",
    thread: { ...opened.thread, ...(plan.creates && loaded !== undefined ? { requested_skills: loaded } : {}) },
    deduplicated: false,
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
  const named = await nameCreatedThread(
    options,
    recorded.thread.thread_id,
    localName,
    await plan.host.visible(),
    callerId,
    view,
  )
  return (
    named === undefined
      ? {
          ...recorded,
          thread: {
            ...recorded.thread,
            name: localName,
            link: threadLink(recorded.thread.thread_id, localName),
          },
          ...local,
        }
      : { ...recorded, ...local, local_name_unavailable: named }
  ) as ThreadToolResult
}

/**
 * Names a thread the create already made, through the same path a rename takes (the create's name check against the
 * device's threads, then the located control's setName). Answers the refusing code instead of failing, because the
 * thread exists either way.
 */
async function nameCreatedThread(
  options: ThreadToolSurfaceOptions,
  threadId: string,
  name: string,
  visible: readonly ThreadSummary[],
  callerId: string,
  view: () => Promise<ThreadHostView>,
): Promise<ThreadErrorCode | undefined> {
  const conflict = checkNameConflict(
    visible.filter((thread) => thread.thread_id !== threadId),
    name,
  )
  if (conflict.kind === "error") return conflict.code
  const located = await locateControl(options, await view(), threadId, true, callerId)
  if (located.kind === "not_live") return "not_resumable"
  if (located.kind === "error") return located.result.kind === "error" ? located.result.error.code : "host_unavailable"
  try {
    await located.control.setName(name)
  } catch (error) {
    const refusal = controlRefusalOf(error)
    if (refusal === undefined) throw error
    return refusal.code
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
        "Call thread_list and pick a thread it lists.",
      ),
    }
  return { kind: "file", sessionPath: entry.session_path }
}
