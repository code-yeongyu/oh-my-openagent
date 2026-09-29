import { expect, test } from "bun:test"
import { syntheticTone } from "./audio"
import type { Speaker } from "./voice-contract"
import { decodeAudioFrame, encodeAudioFrame, WIRE_HEADER_BYTES, WireFormatError } from "./wire"

const speaker: Speaker = { platform_user_id: "UAAA1111", display: "UAAA1111", attribution: "roster" }

test("an audio frame round-trips with its speaker, rate and capture time", () => {
  const pcm16 = syntheticTone({ seconds: 0.05, hz: 440, sample_rate: 48000, amplitude: 0.4 })
  const decoded = decodeAudioFrame(encodeAudioFrame({ direction: "inbound", sample_rate: 48000, at_ms: 1_759_000_000_123, speaker, pcm16 }))
  expect(decoded.direction).toBe("inbound")
  expect(decoded.sample_rate).toBe(48000)
  expect(decoded.at_ms).toBe(1_759_000_000_123)
  expect(decoded.speaker).toEqual(speaker)
  expect(Array.from(decoded.pcm16)).toEqual(Array.from(pcm16))
})

test("a frame with no attributable speaker round-trips as null", () => {
  const decoded = decodeAudioFrame(encodeAudioFrame({ direction: "outbound", sample_rate: 24000, at_ms: 0, speaker: null, pcm16: new Int16Array([1, -1, 32767]) }))
  expect(decoded.speaker).toBeNull()
  expect(decoded.direction).toBe("outbound")
  expect(Array.from(decoded.pcm16)).toEqual([1, -1, 32767])
})

test("samples survive arriving on an odd byte offset", () => {
  const encoded = encodeAudioFrame({ direction: "inbound", sample_rate: 16000, at_ms: 1, speaker: null, pcm16: new Int16Array([7, 8, 9]) })
  const shifted = new Uint8Array(encoded.byteLength + 1)
  shifted.set(encoded, 1)
  expect(Array.from(decodeAudioFrame(shifted.subarray(1)).pcm16)).toEqual([7, 8, 9])
})

test("a frame that is not ours, or not intact, is refused with a reason", () => {
  const good = encodeAudioFrame({ direction: "inbound", sample_rate: 48000, at_ms: 0, speaker: null, pcm16: new Int16Array([1]) })
  expect(() => decodeAudioFrame(good.subarray(0, WIRE_HEADER_BYTES - 1))).toThrow(WireFormatError)
  const badMagic = Uint8Array.from(good)
  badMagic[0] = 0x00
  expect(() => decodeAudioFrame(badMagic)).toThrow(/frame marker/)
  const badVersion = Uint8Array.from(good)
  badVersion[1] = 9
  expect(() => decodeAudioFrame(badVersion)).toThrow(/version 9/)
  const badDirection = Uint8Array.from(good)
  badDirection[2] = 7
  expect(() => decodeAudioFrame(badDirection)).toThrow(/direction/)
  const badRate = Uint8Array.from(good)
  new DataView(badRate.buffer).setUint32(4, 44100, true)
  expect(() => decodeAudioFrame(badRate)).toThrow(/sample rate/)
  expect(() => decodeAudioFrame(good.subarray(0, good.byteLength - 1))).toThrow(/half a sample/)
})
