// Reading the conferencing service's signalling frames.
//
// The huddle's media plane is an SFU that MIXES every remote participant into one audio track, so
// the audio alone can never say who is talking. The service does say it, in the signalling
// websocket: one frame maps each audio stream id to a participant, another reports per-participant
// volume. This module turns those binary frames into plain data so attribution is testable without
// a browser.
//
// The frames are protobuf. We decode them generically (field number plus wire value) and interpret
// only the handful of fields we need, so an unknown or reordered field is ignored instead of
// throwing. Field numbers follow the published conferencing SDK message definitions:
//
//   SignalFrame            2 = type, 18 = audio_metadata, 19 = audio_stream_id_info
//   AudioStreamIdInfoFrame 1 = repeated info
//   AudioStreamIdInfo      1 = audio_stream_id, 2 = attendee_id, 3 = muted, 4 = external_user_id, 5 = dropped
//   AudioMetadataFrame     1 = repeated attendee state
//   AudioAttendeeState     1 = audio_stream_id, 2 = volume, 3 = muted, 4 = signal_strength
//
// Volume follows the SDK's own convention: 0 is loudest and 127 is silence, so a normalised level is
// `1 - volume / 127`. `normaliseVolume` is the single place that knows this.

export type WireField =
  | { field: number; wire: 0; varint: bigint }
  | { field: number; wire: 1; fixed64: bigint }
  | { field: number; wire: 2; bytes: Uint8Array }
  | { field: number; wire: 5; fixed32: number }

class ProtoError extends Error {}

function readVarint(buf: Uint8Array, at: number): { value: bigint; next: number } {
  let value = 0n
  let shift = 0n
  let i = at
  while (i < buf.length) {
    const byte = buf[i] as number
    value |= BigInt(byte & 0x7f) << shift
    i += 1
    if ((byte & 0x80) === 0) return { value, next: i }
    shift += 7n
    if (shift > 63n) throw new ProtoError("varint longer than 64 bits")
  }
  throw new ProtoError("varint ran past the end of the buffer")
}

/** Decode one protobuf message into its fields. Throws when the bytes are not a protobuf message. */
export function readFields(buf: Uint8Array): WireField[] {
  const fields: WireField[] = []
  let i = 0
  while (i < buf.length) {
    const key = readVarint(buf, i)
    i = key.next
    const field = Number(key.value >> 3n)
    const wire = Number(key.value & 7n)
    if (field === 0) throw new ProtoError("field number 0 is not valid")
    if (wire === 0) {
      const v = readVarint(buf, i)
      fields.push({ field, wire: 0, varint: v.value })
      i = v.next
    } else if (wire === 1) {
      if (i + 8 > buf.length) throw new ProtoError("fixed64 ran past the end of the buffer")
      let v = 0n
      for (let b = 7; b >= 0; b--) v = (v << 8n) | BigInt(buf[i + b] as number)
      fields.push({ field, wire: 1, fixed64: v })
      i += 8
    } else if (wire === 2) {
      const len = readVarint(buf, i)
      const end = len.next + Number(len.value)
      if (end > buf.length) throw new ProtoError("length-delimited field ran past the end of the buffer")
      fields.push({ field, wire: 2, bytes: buf.subarray(len.next, end) })
      i = end
    } else if (wire === 5) {
      if (i + 4 > buf.length) throw new ProtoError("fixed32 ran past the end of the buffer")
      fields.push({ field, wire: 5, fixed32: (buf[i] as number) | ((buf[i + 1] as number) << 8) | ((buf[i + 2] as number) << 16) | ((buf[i + 3] as number) << 24) })
      i += 4
    } else {
      throw new ProtoError(`wire type ${wire} is not supported`)
    }
  }
  return fields
}

export function tryReadFields(buf: Uint8Array): WireField[] | null {
  try {
    return readFields(buf)
  } catch {
    return null
  }
}

const varintOf = (fields: readonly WireField[], field: number): bigint | null => {
  for (const f of fields) if (f.field === field && f.wire === 0) return f.varint
  return null
}
const bytesOf = (fields: readonly WireField[], field: number): Uint8Array | null => {
  for (const f of fields) if (f.field === field && f.wire === 2) return f.bytes
  return null
}
const repeatedBytes = (fields: readonly WireField[], field: number): Uint8Array[] => {
  const out: Uint8Array[] = []
  for (const f of fields) if (f.field === field && f.wire === 2) out.push(f.bytes)
  return out
}
const decoder = new TextDecoder()

/** One participant's audio stream, as the service announced it. */
export type AttendeeStream = {
  audio_stream_id: number
  /** the conferencing service's own attendee id */
  attendee_id: string
  /** the chat platform's user id, when the service carries one */
  external_user_id: string
  muted: boolean
  dropped: boolean
}

/** One participant's audio level in a metadata tick. */
export type AttendeeVolume = {
  audio_stream_id: number
  /** 0 is loudest, 127 is silence (the SDK's convention) */
  volume: number
  muted: boolean
  signal_strength: number
}

export type ChimeSignal =
  | { kind: "stream_ids"; streams: readonly AttendeeStream[] }
  | { kind: "audio_metadata"; attendees: readonly AttendeeVolume[] }
  | { kind: "other"; type: number }

const SIGNAL_TYPE = 2
const AUDIO_METADATA = 18
const AUDIO_STREAM_ID_INFO = 19

function interpret(fields: readonly WireField[]): ChimeSignal | null {
  const type = varintOf(fields, SIGNAL_TYPE)
  if (type === null || type <= 0n || type > 64n) return null
  const streamInfo = bytesOf(fields, AUDIO_STREAM_ID_INFO)
  if (streamInfo !== null) {
    const inner = tryReadFields(streamInfo)
    if (inner === null) return null
    const streams: AttendeeStream[] = []
    for (const entry of repeatedBytes(inner, 1)) {
      const one = tryReadFields(entry)
      if (one === null) continue
      const attendee = bytesOf(one, 2)
      const external = bytesOf(one, 4)
      streams.push({
        audio_stream_id: Number(varintOf(one, 1) ?? 0n),
        attendee_id: attendee === null ? "" : decoder.decode(attendee),
        external_user_id: external === null ? "" : decoder.decode(external),
        muted: (varintOf(one, 3) ?? 0n) !== 0n,
        dropped: (varintOf(one, 5) ?? 0n) !== 0n,
      })
    }
    return { kind: "stream_ids", streams }
  }
  const metadata = bytesOf(fields, AUDIO_METADATA)
  if (metadata !== null) {
    const inner = tryReadFields(metadata)
    if (inner === null) return null
    const attendees: AttendeeVolume[] = []
    for (const entry of repeatedBytes(inner, 1)) {
      const one = tryReadFields(entry)
      if (one === null) continue
      attendees.push({
        audio_stream_id: Number(varintOf(one, 1) ?? 0n),
        volume: Number(varintOf(one, 2) ?? 127n),
        muted: (varintOf(one, 3) ?? 0n) !== 0n,
        signal_strength: Number(varintOf(one, 4) ?? 0n),
      })
    }
    return { kind: "audio_metadata", attendees }
  }
  return { kind: "other", type: Number(type) }
}

/**
 * Decode one signalling websocket payload.
 *
 * The transport prefixes some frames with a single type byte, so both offsets are tried and the one
 * that yields a coherent frame wins. Anything else returns null and the caller ignores it.
 */
export function decodeSignalFrame(payload: Uint8Array): ChimeSignal | null {
  const direct = tryReadFields(payload)
  const fromDirect = direct === null ? null : interpret(direct)
  if (fromDirect !== null) return fromDirect
  if (payload.length < 2) return null
  const shifted = tryReadFields(payload.subarray(1))
  return shifted === null ? null : interpret(shifted)
}

/** 0 (loudest) .. 127 (silence) becomes 1 .. 0. */
export function normaliseVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0
  const clamped = Math.min(127, Math.max(0, volume))
  return 1 - clamped / 127
}

/**
 * Who the mixed audio can honestly be attributed to.
 *
 * Exactly one unmuted participant above the threshold means the mix is that person talking. Silence,
 * or two people at once, means the frame carries no single speaker and is left unattributed - a
 * guess here would put words in someone's mouth.
 */
export function soleActiveStream(attendees: readonly AttendeeVolume[], threshold = 0.05): number | null {
  let winner: number | null = null
  for (const attendee of attendees) {
    if (attendee.muted) continue
    if (normaliseVolume(attendee.volume) < threshold) continue
    if (winner !== null) return null
    winner = attendee.audio_stream_id
  }
  return winner
}
