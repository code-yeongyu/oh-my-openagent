// DRAFT of the gateway's voice surface contract. omo-gateway owns the final `src/voice/contract.ts`;
// this copy exists so the huddle adapter can be built before that file lands, and it is replaced by a
// single re-export once it does (agreed with the gateway lane, 2026-09-30).
//
// Amendments agreed over the first draft:
// - `CallEvent` carries `speaking` (start/stop) and `error` (`fatal` = the call is gone; the pipeline
//   tears down and does not auto-rejoin).
// - `speak` accepts 16 kHz, 24 kHz and 48 kHz. Frames published by a huddle are 48 kHz native.
// - `join` keeps `announce` but a voice adapter never posts: the pipeline announces the call on the
//   text surface returned by `textMirror`.

import type { Platform, SurfaceKey } from "../../adapter/contract"

/** Sample rates the voice core exchanges with a surface. */
export type SampleRate = 16000 | 24000 | 48000

/**
 * What a voice surface can do.
 *
 * `speaker_ids` is the honest strength of attribution, not an aspiration:
 * - `"exact"`: the surface delivers one audio stream per speaker.
 * - `"roster"`: the surface delivers a mixed stream plus who the platform says is talking, so a
 *   frame can be labelled when exactly one participant is active and is unattributed otherwise.
 * - `"none"`: audio only.
 */
export type VoiceCapabilities = {
  voice_in: boolean
  voice_out: boolean
  speaker_ids: "exact" | "roster" | "none"
  max_call_minutes: number | null
}

/** One live call: a huddle, a voice channel, a room. `chat_id` is the chat the call belongs to. */
export type CallKey = { platform: Platform; account_id: string; chat_id: string; call_id: string }

/** How sure the surface is that a frame belongs to this speaker. */
export type SpeakerAttribution = "exact" | "roster" | "unattributed"

export type Speaker = {
  /** the platform's user id, or null when the surface cannot name the speaker */
  platform_user_id: string | null
  display: string
  attribution: SpeakerAttribution
}

/** Audio in flight. `pcm16` lives in memory only and is never written to disk by an adapter. */
export type AudioFrame = {
  call: CallKey
  speaker: Speaker
  pcm16: Int16Array
  sample_rate: SampleRate
  at_ms: number
}

export type CallEndReason = "last_human_left" | "command" | "idle" | "platform" | "error"

export type CallEvent =
  | { kind: "joined"; call: CallKey; by: Speaker; roster: readonly Speaker[] }
  | { kind: "left"; call: CallKey; who: Speaker; roster: readonly Speaker[] }
  | { kind: "ended"; call: CallKey; reason: CallEndReason }
  | { kind: "speaking"; call: CallKey; who: Speaker; state: "start" | "stop" }
  /** `fatal`: the call is gone and the pipeline tears down without an automatic rejoin. */
  | { kind: "error"; call: CallKey; message: string; fatal: boolean }

/** A join is always explicit: a command from an allowed user, never an auto-join. */
export type JoinRequest = { platform: Platform; account_id: string; chat_id: string; announce: string }

export interface VoiceSurfaceAdapter {
  readonly platform: Platform
  voiceCapabilities(): VoiceCapabilities
  join(call: JoinRequest, signal: AbortSignal): Promise<CallKey>
  leave(call: CallKey): Promise<void>
  /** Subscribe to inbound audio. Returns the unsubscribe function. */
  onAudio(call: CallKey, sink: (frame: AudioFrame) => void): () => void
  onCallEvent(call: CallKey, sink: (event: CallEvent) => void): () => void
  /** Resolves when the audio has been handed to the platform, or rejects if `signal` aborts. */
  speak(call: CallKey, pcm16: Int16Array, sample_rate: SampleRate, signal: AbortSignal): Promise<void>
  /** Where transcripts and summaries of this call belong, or null when the platform has no such place. */
  textMirror(call: CallKey): SurfaceKey | null
}

/**
 * The surface cannot do what was asked and says so instead of failing quietly: an unsupported
 * capability, or a limit such as one live call per account. Maps to the text contract's
 * `AdapterRefusal` when the voice core lands.
 */
export class VoiceRefusal extends Error {
  readonly reason: "capability" | "busy" | "state"

  constructor(reason: "capability" | "busy" | "state", message: string) {
    super(message)
    this.name = "VoiceRefusal"
    this.reason = reason
  }
}

/**
 * The surface is dead for this account: a revoked session, a browser that cannot run. The connector
 * stops the adapter with one owner notice instead of retrying. Maps to `AdapterFatal`.
 */
export class VoiceFatal extends Error {
  readonly fatal = true as const

  constructor(message: string) {
    super(message)
    this.name = "VoiceFatal"
  }
}
