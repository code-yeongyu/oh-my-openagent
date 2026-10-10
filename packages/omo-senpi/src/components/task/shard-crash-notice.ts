import { readFileSync } from "node:fs"
import { basename, join } from "node:path"

import {
  parseShardBasename,
  type HostShardEvents,
  type ReattachOutcome,
  type ReattachOutcomeInfo,
  type TransportLostInfo,
} from "@oh-my-opencode/senpi-task"

import { hostDaemonDir } from "../../../../senpi-task/src/runners/rpc-host/host-daemon-dir"
import type { HostNotices } from "./host-execution-mode"
import type { CapturedUi } from "./runtime-context"

/**
 * ONE parent-visible notice per task-host crash, and one closing line once its children are back.
 *
 * Every child that loses the same host generation (socket + instanceId) belongs to one episode - a
 * key, never a time window. Its members are every child the runner still had bound to that
 * generation when the first loss arrived, plus any that report a loss later. The episode is
 * announced at its first child that had a turn in flight (a host that dies with nothing running is
 * re-ensured silently by the next spawn) and closed when its last member reports how its recovery
 * ended. Both lines go to the session's notice
 * list (`task_output`) AND to `ui.notify`, which a host-attached session forwards as an
 * `extension_ui_request` notify the Desktop renders as a thread row.
 */

export const SHARD_CRASH_TOKEN = "host_shard_crash"
export const SHARD_CRASH_DONE_TOKEN = "host_shard_crash_done"

export interface ShardCrashFacts {
  readonly supervisorPid?: number
  readonly cause?: string
}

export interface ShardCrashNoticeDeps {
  readonly agentDir: string
  readonly notices: HostNotices
  readonly ui: () => CapturedUi | undefined
  readonly now?: () => number
  readonly readCrash?: (agentDir: string, socket: string, instanceId: string, now: number) => ShardCrashFacts
}

interface Episode {
  readonly id: string
  readonly key: string
  readonly members: Set<string>
  readonly pending: Set<string>
  readonly outcomes: ReattachOutcome[]
  announced: boolean
}

const subagents = (n: number): string => `${n} ${n === 1 ? "subagent" : "subagents"}`

const count = (outcomes: readonly ReattachOutcome[], ...kinds: readonly ReattachOutcome[]): number =>
  outcomes.filter((outcome) => kinds.includes(outcome)).length

export function createShardCrashNotices(deps: ShardCrashNoticeDeps): Required<HostShardEvents> {
  const readCrash = deps.readCrash ?? readNewestHostCrash
  const now = deps.now ?? Date.now
  const open = new Map<string, Episode>()
  const closed = new Set<string>()
  const episodeOfTask = new Map<string, Episode>()

  const emit = (token: string, text: string, type: "warning" | "info"): void => {
    deps.notices.add(text, token)
    deps.ui()?.notify(text, type)
  }

  const announce = (episode: Episode, info: TransportLostInfo): void => {
    episode.announced = true
    const crash = readCrash(deps.agentDir, info.socket, info.instanceId, now())
    const supervisorPid = info.supervisorPid ?? crash.supervisorPid
    const pid = supervisorPid === undefined ? "pid unknown" : `supervisor pid ${supervisorPid}`
    const n = episode.members.size
    const text = `${SHARD_CRASH_TOKEN}:${episode.key} Background task host crashed (shard ${episode.key}, ${pid}, ${crash.cause ?? "cause unknown"}): reattaching ${subagents(n)}...`
    emit(`${SHARD_CRASH_TOKEN}:${episode.id}`, text, "warning")
  }

  // A child that left on its own during recovery is neither reattached nor lost: it is named apart.
  const close = (episode: Episode): void => {
    open.delete(episode.id)
    closed.add(episode.id)
    if (!episode.announced) return
    const cancelled = count(episode.outcomes, "cancelled")
    const lost = count(episode.outcomes, "lost", "host_incompatible")
    const reattached = count(episode.outcomes, "attached", "resumed", "continued")
    // The Desktop parses this shape into its one "Task host restarted" row: the loss leads when there is one.
    const counts =
      lost === 0 ? `${subagents(reattached)} reattached, 0 lost` : `${subagents(lost)} lost (reattach failed), ${reattached} reattached`
    const text = `${SHARD_CRASH_DONE_TOKEN}:${episode.key} ${counts}${cancelled === 0 ? "" : `, ${cancelled} cancelled`}`
    emit(`${SHARD_CRASH_DONE_TOKEN}:${episode.id}`, text, "info")
  }

  const enroll = (episode: Episode, taskId: string): void => {
    if (episode.members.has(taskId)) return
    episode.members.add(taskId)
    episode.pending.add(taskId)
    episodeOfTask.set(taskId, episode)
  }

  return {
    onTransportLost: (info) => {
      const id = `${info.socket}\u0000${info.instanceId}`
      // A straggler of an episode that already closed is not a new crash.
      if (closed.has(id)) return
      let episode = open.get(id)
      if (episode === undefined) {
        const key = endpointKey(deps.agentDir, info.socket)
        episode = { id, key, members: new Set(), pending: new Set(), outcomes: [], announced: false }
        open.set(id, episode)
      }
      for (const taskId of [info.taskId, ...(info.boundTaskIds ?? [])]) enroll(episode, taskId)
      if (info.turnWasInFlight && !episode.announced) announce(episode, info)
    },
    onReattachOutcome: (info: ReattachOutcomeInfo) => {
      const episode = episodeOfTask.get(info.taskId)
      if (episode === undefined || !episode.pending.delete(info.taskId)) return
      episodeOfTask.delete(info.taskId)
      episode.outcomes.push(info.outcome)
      if (episode.pending.size === 0) close(episode)
    },
  }
}

function endpointKey(agentDir: string, socket: string): string {
  return parseShardBasename(socket)?.key ?? basename(hostDaemonDir(agentDir, socket))
}

/** A record older than this belongs to an earlier crash of the endpoint, not the one being announced. */
const CRASH_RECORD_FRESH_MS = 5 * 60_000

// The generation record names the SUPERVISOR; it survives only until the crash path cleans it.
export function readNewestHostCrash(agentDir: string, socket: string, instanceId: string, now: number): ShardCrashFacts {
  const dir = hostDaemonDir(agentDir, socket)
  const supervisorPid = readPid(join(dir, "generations", instanceId, "host.pid"))
  const newest = readLines(join(dir, "crashes.jsonl")).map(parseRecord).findLast((record) => record !== undefined)
  const fresh = newest !== undefined && now - Date.parse(newest.at) <= CRASH_RECORD_FRESH_MS
  const cause = fresh ? newest.cause : undefined
  return { ...(supervisorPid === undefined ? {} : { supervisorPid }), ...(cause === undefined ? {} : { cause }) }
}

function parseRecord(line: string): { readonly at: string; readonly cause?: string } | undefined {
  const value = parseJson(line)
  if (value === undefined || typeof value.at !== "string" || Number.isNaN(Date.parse(value.at))) return undefined
  if (typeof value.signal === "string") return { at: value.at, cause: value.signal }
  if (typeof value.code === "number") return { at: value.at, cause: `exit code ${value.code}` }
  return { at: value.at }
}

function readPid(file: string): number | undefined {
  const pid = parseJson(readText(file) ?? "")?.pid
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : undefined
}

function readLines(file: string): readonly string[] {
  return (readText(file) ?? "").split("\n").filter((line) => line.trim().length > 0)
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return undefined
  }
}

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}
