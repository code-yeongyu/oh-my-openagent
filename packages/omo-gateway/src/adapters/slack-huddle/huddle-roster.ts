// Who is in the call, and who is talking.
//
// The media plane mixes every participant into one audio track, so the audio itself can never say
// who is speaking. The signalling frames can: one names the participant behind each audio stream,
// the other reports per-participant volume. This module turns those into roster and speaking
// changes, with no browser involved, so the rules that decide attribution are testable on their own.

import type { AttendeeStream, AttendeeVolume } from "./chime"
import { soleActiveStream } from "./chime"
import type { Speaker } from "./voice-contract"

export type RosterEvent =
  | { readonly kind: "joined"; readonly who: Speaker }
  | { readonly kind: "left"; readonly who: Speaker }
  | { readonly kind: "speaking"; readonly who: Speaker; readonly state: "start" | "stop" }

/**
 * A participant as a speaker.
 *
 * Attribution is "roster", never "exact": the platform tells us who is talking, but the audio is a
 * mix, so a frame labelled with this speaker is the platform's word, not a separated stream.
 */
export const speakerOf = (stream: AttendeeStream): Speaker =>
  stream.external_user_id === ""
    ? { platform_user_id: null, display: stream.attendee_id, attribution: "unattributed" }
    : { platform_user_id: stream.external_user_id, display: stream.external_user_id, attribution: "roster" }

const MIXED: Speaker = { platform_user_id: null, display: "mixed", attribution: "unattributed" }

export class HuddleRoster {
  private readonly streams = new Map<number, AttendeeStream>()
  private speaking: number | null = null

  /** Everyone currently in the call. */
  speakers(): readonly Speaker[] {
    const out: Speaker[] = []
    for (const stream of this.streams.values()) if (!stream.dropped) out.push(speakerOf(stream))
    return out
  }

  /**
   * Who the mixed audio belongs to right now. One audible participant means the mix is that person;
   * silence or crosstalk means the frame is honestly unattributed rather than guessed.
   */
  current(): Speaker {
    const active = this.speaking
    if (active === null) return MIXED
    const stream = this.streams.get(active)
    return stream === undefined ? MIXED : speakerOf(stream)
  }

  /** True once the roster has seen someone who is not this account. */
  hasOther(selfUserId: string | null): boolean {
    for (const stream of this.streams.values()) {
      if (stream.dropped) continue
      if (stream.external_user_id !== "" && stream.external_user_id !== selfUserId) return true
    }
    return false
  }

  /** Apply a stream-id announcement; returns who joined and who left since the last one. */
  applyStreams(streams: readonly AttendeeStream[]): readonly RosterEvent[] {
    const events: RosterEvent[] = []
    const seen = new Set<number>()
    for (const stream of streams) {
      seen.add(stream.audio_stream_id)
      const known = this.streams.get(stream.audio_stream_id)
      this.streams.set(stream.audio_stream_id, stream)
      if (known === undefined && !stream.dropped) events.push({ kind: "joined", who: speakerOf(stream) })
      if (stream.dropped && known !== undefined && !known.dropped) events.push({ kind: "left", who: speakerOf(stream) })
    }
    for (const [id, stream] of [...this.streams]) {
      if (seen.has(id)) continue
      this.streams.delete(id)
      if (!stream.dropped) events.push({ kind: "left", who: speakerOf(stream) })
    }
    return events
  }

  /** Apply a volume tick; returns the speaking transitions it caused, if any. */
  applyVolumes(attendees: readonly AttendeeVolume[]): readonly RosterEvent[] {
    const active = soleActiveStream(attendees)
    if (active === this.speaking) return []
    const events: RosterEvent[] = []
    const previous = this.speaking === null ? undefined : this.streams.get(this.speaking)
    this.speaking = active
    if (previous !== undefined) events.push({ kind: "speaking", who: speakerOf(previous), state: "stop" })
    const next = active === null ? undefined : this.streams.get(active)
    if (next !== undefined) events.push({ kind: "speaking", who: speakerOf(next), state: "start" })
    return events
  }
}
