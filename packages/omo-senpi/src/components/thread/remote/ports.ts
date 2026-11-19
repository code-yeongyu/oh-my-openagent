import type { RemoteClient } from "../../remote"
import type { DeviceService } from "@oh-my-opencode/device-service-core/device-service"
import type { AliasRegistry } from "./alias-port"
import type { ThreadStatus } from "../contracts/results"

export type JsonObject = { readonly [key: string]: unknown }

/** One row of the account-scoped session list (the device service's `sessions.list` listing). */
export type RemoteSessionRow = {
  readonly device: string
  readonly session_id: string
  /** The session's omo durable id when its device publishes it (#12996); a delivery header names its sender by this id. */
  readonly durable_id?: string
  readonly title: string
  readonly project: string
  /**
   * The session's place on its device as the device service lists it: relayd lists its working folder (`cwd`, else
   * `"unknown"`), never its session file, so `open_session` never takes it (#14170: a folder opened is EISDIR).
   */
  readonly path: string
  /** The session file on its own device, known only from that device's own answer (an unload's reply, #14170). */
  readonly session_file?: string
  readonly state: string
  readonly updated_ms: number
  /**
   * `live`: the device answered this listing round. `cache`: it did not, and the relay served its last snapshot, whose
   * `state` is only what it was then (#14043). Absent (an older service, a row built here): treated as `live`.
   */
  readonly source?: "live" | "cache"
  /** On a `cache` row: when the device's last snapshot was taken (epoch ms). */
  readonly as_of?: number
  /** Rows 4 (omo-relay-spec#295): the session's current model as its engine names it; absent when unknown. */
  readonly model?: { readonly provider: string; readonly id: string }
  /** Rows 4: the engine archived the session; absent means not archived. */
  readonly archived?: true
}

export type RemoteDevice = {
  readonly device: string
  readonly label: string
  readonly online: boolean
  readonly platform?: string
  readonly kind?: string
  readonly last_seen_ms?: number | null
}

/** One account listing: its rows, and the devices whose rows this listing could not include (timed out, unanswered). */
export type RemoteListing = { readonly rows: readonly RemoteSessionRow[]; readonly incomplete: readonly string[] }

/**
 * How a command sent to another device ended. `refused` carries the receiving side's reason
 * (`capability_missing` without a grant, `host_detached` when the device is not attached to the relay);
 * `uncertain` means it may have run (the relay lost the evidence), so it is never retried blindly.
 */
export type RemoteCommandOutcome =
  /**
   * `local`: answered from the session's mirror on this device, with no round trip. `located`: the listing key of the
   * session an endpoint open made, when the open asked for it and the host named it on the reply.
   */
  | { readonly kind: "ok"; readonly response: JsonObject; readonly local?: true; readonly located?: string }
  /** `detail`: the receiving service's own reason in the command's receipt (`receipt.reason`), when it names one. */
  | { readonly kind: "refused"; readonly reason: string; readonly detail?: string }
  | { readonly kind: "uncertain"; readonly reason: string }

/**
 * One single-probe look for a durable id on one device (omo#13037 A4.3.3): `found` names the device's stable key for it,
 * `none` that the device answered and holds no such session, `silent` that it did not answer within the bound, and
 * `unavailable` that this device's own service cannot make the single probe (no lookup is made at all).
 */
export type RemoteLookupOutcome =
  | { readonly kind: "found"; readonly key: string }
  | { readonly kind: "none" }
  | { readonly kind: "silent"; readonly reason: string }
  | { readonly kind: "unavailable" }

export type RemoteServiceState = { readonly state: string }

/**
 * A dialer of one device-service connection, naming whether the caller owns it: an owned connection is closed
 * once its work settles, a borrowed one stays open for its owner to close.
 */
export type DeviceServiceDial = () => Promise<{ readonly conn: DeviceService; readonly owned: boolean }>

export type RemoteLocateOutcome =
  { readonly kind: "ok"; readonly sessionId: string } | { readonly kind: "refused"; readonly reason: string }

/**
 * Why a watch ended for good. `stopped`: its holder stopped it. `session_closed` / `session_replaced`: the session left
 * its device's engine and could not be found again by its durable id. The access reasons (the relay's revocations, and
 * the refusals a re-attach can meet) never retry. `listener_failed`: a handler threw.
 */
export type RemoteWatchEnd = "stopped" | "session_closed" | "session_replaced" | "listener_failed" | `access:${string}`

/** The engine's session status (senpi `session_status`), or what a fresh `get_state` implies when no record said it. */
export type RemoteSessionState = {
  readonly status: string
  readonly sessionId: string
  readonly durableSessionId?: string
  readonly currentTurnId?: string
}

export type RemoteStatusChange = {
  readonly from: string | undefined
  readonly to: string
  /** True when the session's stream carries no `session_status` record and the change was read off its lifecycle records. */
  readonly derived: boolean
  readonly cause?: string
}

/** What a watch reports after a gap (a re-established attach, a re-attach, an overflowed queue): the session now. */
export type RemoteResync = {
  readonly from: string | undefined
  readonly state: RemoteSessionState
  /** Turns that settled while the watch could not see them, each reported once per turn id across the watch. */
  readonly settledTurns: readonly string[]
  /** The session was found again under a new key after its engine let it go (an engine restart). */
  readonly restarted: boolean
}

export type RemoteWatchHandlers = {
  /** Each record the session writes from now on, once: a record seq or turn id already applied is dropped. */
  readonly record: (record: JsonObject) => void
  readonly status?: (change: RemoteStatusChange) => void
  readonly resynced?: (resync: RemoteResync) => void
  /** Once per gap: the attach or the device service went away; the watch re-attaches with backoff. */
  readonly lost?: (reason: string) => void
}

export type RemoteWatchOptions = {
  /** Read the session's state once before the watch is returned, for a caller that shows where it starts. */
  readonly baseline?: boolean
}

/**
 * A session on another device followed from now on, across relay drops, device-service restarts and engine restarts,
 * until `stop` or an end that no re-attach can undo.
 */
export type RemoteSessionWatch = {
  /** Settles once with why the watch ended; nothing is delivered after it. */
  readonly ended: Promise<RemoteWatchEnd>
  /** The session's state when the watch started (`baseline`), else undefined. */
  readonly initial?: RemoteSessionState
  readonly stop: () => void
}

export type RemoteWatchOutcome =
  { readonly kind: "ok"; readonly watch: RemoteSessionWatch } | { readonly kind: "refused"; readonly reason: string }

export type RemoteSessionsPort = {
  /** The device service state; `plan_required` means the account's plan has no relay (A5: paid only). */
  readonly status: () => Promise<RemoteServiceState>
  readonly thisDevice: () => Promise<string | null>
  /** This device's own name. The account roster (`devices`) leaves this device out. Absent: the id stands in for it. */
  readonly thisDeviceName?: () => Promise<string | null>
  readonly devices: () => Promise<readonly RemoteDevice[]>
  /** The account's session list; with `device`, that one device's rows only (no account-wide round). */
  readonly sessions: (filter?: { readonly device?: string }) => Promise<readonly RemoteSessionRow[]>
  /** The account-wide list as `sessions` gives it, with the devices it could not include. Absent: every device counts as listed. */
  readonly listing?: () => Promise<RemoteListing>
  /**
   * A session-less engine record (`open_session`, `list_sessions`) on `device`'s engine endpoint, with no
   * attach: the attach-less `session.command {device, endpoint, rpc}` shape (relay daemon #393). `locate` asks a
   * create or fork for its new session's listing key on the reply (`located`), so no session.locate follows it.
   * An `open_session` rides the endpoint dialer: a fresh owned connection per call by default, closed once the
   * record settles (#12777). Sent on the long-lived connection it would attach the host's delegated engine
   * connection to the session as well, and the engine would write each streamed delta twice; the attach that
   * follows rides the long-lived connection, which then carries one copy per delta. Every other record rides the
   * long-lived connection.
   */
  readonly endpointCommand: (
    device: string,
    rpc: JsonObject,
    options?: { readonly locate?: boolean },
  ) => Promise<RemoteCommandOutcome>
  /**
   * The id a session just created on `device` is addressed by (its listing row's `session_id`, the key an attach
   * takes), from the durable engine session id the create reply names; settles once that id attaches. A `knownKey` the
   * create reply already named is the answer as is: nothing is sent.
   */
  readonly locate: (device: string, engineId: string, knownKey?: string) => Promise<RemoteLocateOutcome>
  /**
   * An engine record for one session on `device` (`prompt`, `abort`, `get_state`), through an attach. A read the
   * session's mirror holds is answered locally unless `fresh` is set. `direct` sends it to the session `device` lists
   * under `sessionId` with no attach (one round trip instead of two), for a record that needs no session events back; a
   * service that refuses that before sending (older than #393 part B) gets the record through an attach instead.
   */
  readonly sessionCommand: (
    device: string,
    sessionId: string,
    rpc: JsonObject,
    options?: { readonly fresh?: boolean; readonly direct?: boolean },
  ) => Promise<RemoteCommandOutcome>
  readonly read: (device: string, sessionId: string, tail: number) => Promise<RemoteCommandOutcome>
  /** omo#13037 A4.2/A4.3: one single-probe locate of `durableId` on `device`. Absent: no lookup is ever made. */
  readonly lookup?: (device: string, durableId: string) => Promise<RemoteLookupOutcome>
  /**
   * omo#13037 5.4: an `admit_external_message` record to a session of `device` that no listing maps, by its durable id.
   * `unavailable` when this device's own service cannot carry it (nothing is sent). Absent: the same as `unavailable`.
   */
  readonly wake?: (
    device: string,
    durableId: string,
    rpc: JsonObject,
  ) => Promise<RemoteCommandOutcome | { readonly kind: "unavailable" }>
  /** Whether `wake` can be sent at all, read before deciding a lane (nothing is sent). Absent: false. */
  readonly canWake?: () => Promise<boolean>
  /** omo#13037: this device's own service can make the single probe (read from its connection; no round trip). */
  readonly canLookup?: () => Promise<boolean>
  /**
   * The records `device`'s session writes from now on (none of the ones before), on the attach this port holds for it,
   * shared with every other holder, re-attached and resynced after a gap. Refused, typed, when that attach cannot be made.
   */
  readonly watch: (
    device: string,
    sessionId: string,
    handlers: RemoteWatchHandlers,
    options?: RemoteWatchOptions,
  ) => Promise<RemoteWatchOutcome>
  /**
   * #14170 (`closed-rows.ts`): this surface closed `row`'s session, whose unload named `file`. Until the listing catches
   * up it lists the row ended, carrying that file as `session_file`. Absent: the listing is read as it comes.
   */
  readonly closed?: (row: RemoteSessionRow, file: string | undefined) => void
  /**
   * #14170: `row`'s session runs again under `key` (this surface reopened it, or its holder says an engine runs it), so a
   * closed mark no longer applies.
   */
  readonly reopened?: (row: RemoteSessionRow, key: string) => void
  /** Closes the device-service connection this port opened, if any; a short-lived caller (the CLI) calls it at the end. */
  readonly close?: () => Promise<void>
}

/**
 * The count a thread chain carries to another device (K8; R8.c). The engine record field that holds it is
 * named by senpi S32; until that engine release, `stamp` is the identity and the count does not cross.
 */
export type ChainCountWire = {
  readonly stamp: (record: JsonObject, hop: number) => JsonObject
}

export type { AliasError, AliasErrorCode, AliasHolder, AliasRegistry, AliasResult } from "./alias-port"

/** Everything the tools need to reach past this machine. Absent: the tools are exactly the local ones. */
/**
 * senpi's `buildSessionProjection(entries, leafId).entries`: the session's context along the leaf, each projected entry
 * with the messages it contributes (`get_messages` answers exactly these messages). A paged thread_read projects the
 * entries it fetched with it (#14047).
 */
export type SessionProjector = (
  entries: readonly JsonObject[],
  leafId: string | null,
) => readonly { readonly sourceEntry: { readonly id: string }; readonly messages: readonly object[] }[]

export type RemoteThreadSurface = {
  readonly sessions: RemoteSessionsPort
  /** The engine's own projector, loaded on the first paged read; absent (the CLI), remote reads take `get_messages`. */
  readonly loadProjector?: () => Promise<SessionProjector>
  /** The one remote client (#13414): the account's state, this device and the device list are read through it. */
  readonly client: RemoteClient
  /** Absent until the account service's alias registry ships: aliases are then refused typed, never guessed. */
  readonly aliases?: AliasRegistry
  readonly chain: ChainCountWire
  /** The approval mode a session this surface creates is opened in (#6189): the creator's own. Absent: none is named. */
  readonly permissionPreset?: () => string | undefined
}

/** The id a listing row has ABOVE the ports (decision 0027 D2): its durable id and nothing else; "" when the device publishes none. */
export const rowThreadId = (row: RemoteSessionRow): string => row.durable_id ?? ""

/**
 * A listing row's thread status. Live only when its device answered this round with a non-ended state: a cached row of a
 * device that did not answer is a snapshot (often days old, of sessions long gone), never proof the session runs (#14043).
 */
export const rowStatus = (row: RemoteSessionRow): ThreadStatus =>
  row.state === "ended" || row.source === "cache" ? "resumable" : "live"

/** A listing row's display name: its title, else its folder's name, so no listed thread shows an empty name (#14043). */
export const rowLabel = (row: RemoteSessionRow): string =>
  row.title !== "" ? row.title : (row.project.split(/[\\/]/).findLast((part) => part !== "") ?? "")

/**
 * The one rule for a probe-built `ended` row (#13238 review): a probe may build one only while this device's service
 * can carry the wake, since an ended row goes down the wake path; with the wake off it would go down the live path and
 * attach to a key no engine runs. Every probe site (holderTarget, replyOnDevice, lookupAcross) asks this first.
 */
export async function probeMayBuildEndedRow(sessions: Pick<RemoteSessionsPort, "canWake">): Promise<boolean> {
  return (await sessions.canWake?.().catch(() => false)) === true
}

/**
 * A session a device holds on disk but no engine runs (omo#13037 A4.2): built from that device's own probe answer, its
 * stable key and the durable id. It carries no name and no folder, and its state `ended` sends a delivery down the wake path.
 */
export function endedRow(device: string, key: string, durableId: string): RemoteSessionRow {
  return {
    device,
    session_id: key,
    durable_id: durableId,
    title: "",
    project: "",
    path: "",
    state: "ended",
    updated_ms: 0,
  }
}
