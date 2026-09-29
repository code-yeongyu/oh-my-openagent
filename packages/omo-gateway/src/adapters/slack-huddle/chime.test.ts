import { expect, test } from "bun:test"
import { decodeSignalFrame, normaliseVolume, readFields, soleActiveStream } from "./chime"

// An independent little protobuf writer: the decoder is never used to build its own input.
const varint = (value: number): number[] => {
  const out: number[] = []
  let left = value
  do {
    let byte = left & 0x7f
    left >>>= 7
    if (left > 0) byte |= 0x80
    out.push(byte)
  } while (left > 0)
  return out
}
const tag = (field: number, wire: number): number[] => varint((field << 3) | wire)
const num = (field: number, value: number): number[] => [...tag(field, 0), ...varint(value)]
const len = (field: number, body: readonly number[]): number[] => [...tag(field, 2), ...varint(body.length), ...body]
const str = (field: number, value: string): number[] => len(field, [...new TextEncoder().encode(value)])
const bytes = (parts: readonly number[]): Uint8Array => new Uint8Array(parts)

const streamIdFrame = (entries: readonly { id: number; attendee: string; external: string; muted?: boolean; dropped?: boolean }[]): number[] => [
  ...num(1, 1_759_000_000_000),
  ...num(2, 18),
  ...len(19, entries.flatMap((e) => len(1, [...num(1, e.id), ...str(2, e.attendee), ...num(3, e.muted === true ? 1 : 0), ...str(4, e.external), ...num(5, e.dropped === true ? 1 : 0)]))),
]

const metadataFrame = (entries: readonly { id: number; volume: number; muted?: boolean; signal?: number }[]): number[] => [
  ...num(1, 1_759_000_000_001),
  ...num(2, 17),
  ...len(18, entries.flatMap((e) => len(1, [...num(1, e.id), ...num(2, e.volume), ...num(3, e.muted === true ? 1 : 0), ...num(4, e.signal ?? 3)]))),
]

test("a stream-id frame names the participant behind each audio stream", () => {
  const frame = decodeSignalFrame(bytes(streamIdFrame([
    { id: 7, attendee: "attendee-a", external: "UAAA1111" },
    { id: 9, attendee: "attendee-b", external: "UBBB2222", muted: true, dropped: true },
  ])))
  expect(frame).toEqual({
    kind: "stream_ids",
    streams: [
      { audio_stream_id: 7, attendee_id: "attendee-a", external_user_id: "UAAA1111", muted: false, dropped: false },
      { audio_stream_id: 9, attendee_id: "attendee-b", external_user_id: "UBBB2222", muted: true, dropped: true },
    ],
  })
})

test("a metadata frame carries one volume per stream", () => {
  expect(decodeSignalFrame(bytes(metadataFrame([{ id: 7, volume: 12 }, { id: 9, volume: 127, muted: true, signal: 0 }])))).toEqual({
    kind: "audio_metadata",
    attendees: [
      { audio_stream_id: 7, volume: 12, muted: false, signal_strength: 3 },
      { audio_stream_id: 9, volume: 127, muted: true, signal_strength: 0 },
    ],
  })
})

test("a frame behind a one-byte transport prefix decodes the same way", () => {
  const body = streamIdFrame([{ id: 3, attendee: "attendee-c", external: "UCCC3333" }])
  const prefixed = decodeSignalFrame(bytes([0x05, ...body]))
  expect(prefixed).toEqual(decodeSignalFrame(bytes(body)))
  expect((prefixed as { kind: string }).kind).toBe("stream_ids")
})

test("a frame the module does not model is reported as other, and noise is ignored", () => {
  expect(decodeSignalFrame(bytes([...num(1, 1), ...num(2, 19)]))).toEqual({ kind: "other", type: 19 })
  expect(decodeSignalFrame(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toBeNull()
  expect(decodeSignalFrame(new Uint8Array([]))).toBeNull()
})

test("malformed protobuf is refused rather than silently truncated", () => {
  expect(() => readFields(new Uint8Array([...tag(1, 2), 0x40, 0x01]))).toThrow(/past the end/)
})

test("volume is inverted: 0 is loudest, 127 is silence", () => {
  expect(normaliseVolume(0)).toBe(1)
  expect(normaliseVolume(127)).toBe(0)
  expect(normaliseVolume(-5)).toBe(1)
  expect(normaliseVolume(999)).toBe(0)
  expect(normaliseVolume(Number.NaN)).toBe(0)
})

test("the mix is attributed only when exactly one unmuted participant is audible", () => {
  expect(soleActiveStream([{ audio_stream_id: 7, volume: 10, muted: false, signal_strength: 3 }, { audio_stream_id: 9, volume: 127, muted: false, signal_strength: 0 }])).toBe(7)
  expect(soleActiveStream([{ audio_stream_id: 7, volume: 10, muted: false, signal_strength: 3 }, { audio_stream_id: 9, volume: 20, muted: false, signal_strength: 3 }])).toBeNull()
  expect(soleActiveStream([{ audio_stream_id: 7, volume: 127, muted: false, signal_strength: 0 }])).toBeNull()
  expect(soleActiveStream([{ audio_stream_id: 7, volume: 0, muted: true, signal_strength: 5 }])).toBeNull()
})
