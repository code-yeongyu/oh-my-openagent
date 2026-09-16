import type { EntryRenderer } from "@code-yeongyu/senpi"
import {
  REFLECTION_PARK_PROBE_INTERVAL_MS,
  readReflectionParkFile,
  type ReflectionParkState,
} from "@oh-my-opencode/memory-core"

import { safeNotify, type ReflectionCompletionApi, type ReflectionLiveSession } from "./completion"
import {
  detailExcerpt,
  joinFields,
  noticeComponent,
  normalizeRendererText,
  optionalRendererText,
} from "./entry-renderers"
import { childFailureCause } from "./failure-detail"
import { reflectionRemediation } from "./remediation"

export const REFLECTION_PARKED_ENTRY_TYPE = "senpi-memory.reflection-parked"

export interface ReflectionParkedEntry {
  readonly schemaVersion: 1
  readonly identity: string
  readonly streak: number
  readonly parkedAt: string
  readonly nextProbeAt: string
  readonly retryable: boolean
  readonly lastReason: string
  readonly lastDetail?: string
  readonly recommendation: string
}

export const renderReflectionParkedEntry: EntryRenderer<ReflectionParkedEntry> = (entry, options, theme) => {
  const parked = entry.data
  if (!parked) return undefined
  const cause = childFailureCause(parked.lastDetail)
  return noticeComponent(
    {
      glyph: "⏸",
      title: `Automatic memory reflection paused · ${parked.streak} failure${parked.streak === 1 ? "" : "s"} in a row`,
      tone: "warning",
      why: `${sentence(parked.recommendation)} Run /reflect to retry now; the next automatic probe is at ${normalizeRendererText(parked.nextProbeAt)}.`,
      detail: joinFields([
        `reason ${normalizeRendererText(parked.lastReason)}`,
        optionalRendererText(cause) === undefined ? undefined : detailExcerpt(cause ?? ""),
        parked.retryable ? "transient failure class" : "deterministic failure class",
        `since ${normalizeRendererText(parked.parkedAt)}`,
        `identity ${normalizeRendererText(parked.identity)}`,
      ]),
    },
    options,
    theme,
  )
}

export function registerReflectionParkedRenderer(api: ReflectionCompletionApi): void {
  api.registerEntryRenderer(REFLECTION_PARKED_ENTRY_TYPE, renderReflectionParkedEntry)
}

export function reflectionParkNextProbeAt(park: ReflectionParkState): string | undefined {
  if (park.parkedAt === undefined) return undefined
  return new Date(Date.parse(park.lastProbeAt ?? park.parkedAt) + REFLECTION_PARK_PROBE_INTERVAL_MS).toISOString()
}

/**
 * Announces a parked identity once per session per park episode: the park edge right after the
 * failure that parked it, and a reminder when a later session binds an identity that is still
 * parked. Reads the durable park file so every caller sees the same state the scheduler wrote.
 */
export async function emitReflectionParkAlert(
  reflectionDir: string,
  identity: string,
  live: ReflectionLiveSession | undefined,
  once: (key: string) => boolean,
): Promise<boolean> {
  if (!live?.ui) return false
  const park = await readReflectionParkFile(reflectionDir)
  const nextProbeAt = reflectionParkNextProbeAt(park)
  if (park.parkedAt === undefined || nextProbeAt === undefined) return false
  if (!once(`${live.sessionId}:parked:${park.parkedAt}`)) return false
  const failure = park.lastFailure
  const recommendation = reflectionRemediation(failure?.reason, failure?.detail)
  const cause = childFailureCause(failure?.detail)
  const entry: ReflectionParkedEntry = {
    schemaVersion: 1,
    identity,
    streak: park.streak,
    parkedAt: park.parkedAt,
    nextProbeAt,
    retryable: failure?.retryable ?? true,
    lastReason: failure?.reason ?? "failed",
    ...(cause === undefined ? {} : { lastDetail: cause }),
    recommendation,
  }
  live.api.appendEntry(REFLECTION_PARKED_ENTRY_TYPE, entry)
  safeNotify(
    live,
    joinFields([
      `Automatic memory reflection paused after ${park.streak} failures`,
      cause ?? failure?.reason,
      recommendation,
      `next automatic probe ${nextProbeAt}; run /reflect to retry now`,
    ]),
    "warning",
  )
  return true
}

function sentence(text: string): string {
  const normalized = normalizeRendererText(text).trim()
  if (normalized.length === 0) return "Automatic reflection is paused until a retry succeeds."
  const capitalized = `${normalized[0]!.toUpperCase()}${normalized.slice(1)}`
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`
}
