// The local surface's wire format.
//
// Events and commands are JSON text frames. Audio is a binary frame, because base64 in JSON would
// cost a third more bytes on every block in both directions. One frame carries one block of 16-bit
// mono samples plus who it came from.
//
//   0      magic 0xA0
//   1      version
//   2      direction (1 inbound, 2 outbound)
//   3      reserved
//   4..8   sample rate, unsigned 32-bit
//   8..16  capture time in epoch milliseconds, float 64
//   16..18 speaker JSON length, unsigned 16-bit
//   18..   speaker JSON, then the samples

import { isSampleRate } from "./audio"
import type { AudioFrame, SampleRate, Speaker } from "./voice-contract"

export const WIRE_MAGIC = 0xa0
export const WIRE_VERSION = 1
export const WIRE_HEADER_BYTES = 18

export type WireDirection = "inbound" | "outbound"

export type WireAudio = {
  readonly direction: WireDirection
  readonly sample_rate: SampleRate
  readonly at_ms: number
  readonly speaker: Speaker | null
  readonly pcm16: Int16Array
}

const DIRECTION_CODE: Record<WireDirection, number> = { inbound: 1, outbound: 2 }

export class WireFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WireFormatError"
  }
}

export function encodeAudioFrame(frame: WireAudio): Uint8Array {
  const speaker = frame.speaker === null ? "" : JSON.stringify(frame.speaker)
  const speakerBytes = new TextEncoder().encode(speaker)
  const out = new Uint8Array(WIRE_HEADER_BYTES + speakerBytes.byteLength + frame.pcm16.byteLength)
  const view = new DataView(out.buffer)
  out[0] = WIRE_MAGIC
  out[1] = WIRE_VERSION
  out[2] = DIRECTION_CODE[frame.direction]
  view.setUint32(4, frame.sample_rate, true)
  view.setFloat64(8, frame.at_ms, true)
  view.setUint16(16, speakerBytes.byteLength, true)
  out.set(speakerBytes, WIRE_HEADER_BYTES)
  out.set(new Uint8Array(frame.pcm16.buffer, frame.pcm16.byteOffset, frame.pcm16.byteLength), WIRE_HEADER_BYTES + speakerBytes.byteLength)
  return out
}

export function decodeAudioFrame(bytes: Uint8Array): WireAudio {
  if (bytes.byteLength < WIRE_HEADER_BYTES) throw new WireFormatError("audio frame is shorter than its header")
  if (bytes[0] !== WIRE_MAGIC) throw new WireFormatError("audio frame does not start with the frame marker")
  if (bytes[1] !== WIRE_VERSION) throw new WireFormatError(`audio frame version ${String(bytes[1])} is not supported`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const direction = bytes[2] === DIRECTION_CODE.inbound ? "inbound" : bytes[2] === DIRECTION_CODE.outbound ? "outbound" : null
  if (direction === null) throw new WireFormatError("audio frame carries no known direction")
  const sample_rate = view.getUint32(4, true)
  if (!isSampleRate(sample_rate)) throw new WireFormatError(`audio frame carries an unsupported sample rate (${sample_rate})`)
  const speakerLength = view.getUint16(16, true)
  const pcmStart = WIRE_HEADER_BYTES + speakerLength
  if (bytes.byteLength < pcmStart) throw new WireFormatError("audio frame is shorter than its speaker field claims")
  const speakerJson = new TextDecoder().decode(bytes.subarray(WIRE_HEADER_BYTES, pcmStart))
  const pcmBytes = bytes.subarray(pcmStart)
  if (pcmBytes.byteLength % 2 !== 0) throw new WireFormatError("audio frame carries half a sample")
  // the samples may start on an odd offset inside the incoming buffer, so they are copied out
  const pcm16 = new Int16Array(pcmBytes.byteLength / 2)
  new Uint8Array(pcm16.buffer).set(pcmBytes)
  return { direction, sample_rate, at_ms: view.getFloat64(8, true), speaker: speakerJson === "" ? null : parseSpeaker(speakerJson), pcm16 }
}

function parseSpeaker(json: string): Speaker | null {
  const parsed: unknown = JSON.parse(json)
  if (typeof parsed !== "object" || parsed === null) return null
  const record: Record<string, unknown> = { ...parsed }
  const attribution = record.attribution
  if (attribution !== "exact" && attribution !== "roster" && attribution !== "unattributed") return null
  return {
    platform_user_id: typeof record.platform_user_id === "string" ? record.platform_user_id : null,
    display: typeof record.display === "string" ? record.display : "",
    attribution,
  }
}

export const inboundFrame = (frame: AudioFrame): Uint8Array =>
  encodeAudioFrame({ direction: "inbound", sample_rate: frame.sample_rate, at_ms: frame.at_ms, speaker: frame.speaker, pcm16: frame.pcm16 })
