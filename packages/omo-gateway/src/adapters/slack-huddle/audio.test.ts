import { expect, test } from "bun:test"
import { base64ToPcm16, chunkPcm16, floatToPcm16, pcm16ToBase64, pcm16ToFloat, peakLevel, resamplePcm16, syntheticTone } from "./audio"

test("float and 16-bit samples round-trip, and anything past full scale is clamped", () => {
  const source = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2])
  const pcm = floatToPcm16(source)
  expect(pcm[3]).toBe(32_767)
  expect(pcm[4]).toBe(-32_768)
  expect(pcm[5]).toBe(32_767)
  expect(pcm[6]).toBe(-32_768)
  const back = pcm16ToFloat(pcm)
  expect(back[1]).toBeCloseTo(0.5, 3)
  expect(back[2]).toBeCloseTo(-0.5, 3)
})

test("resampling changes the sample count by the rate ratio and keeps the waveform's level", () => {
  const source = syntheticTone({ seconds: 0.1, hz: 440, sample_rate: 48000, amplitude: 0.5 })
  expect(source.length).toBe(4_800)
  const down = resamplePcm16(source, 48000, 24000)
  expect(down.length).toBe(2_400)
  expect(peakLevel(down)).toBeCloseTo(0.5, 1)
  const up = resamplePcm16(down, 24000, 48000)
  expect(up.length).toBe(4_800)
  expect(peakLevel(up)).toBeCloseTo(0.5, 1)
  expect(resamplePcm16(source, 48000, 48000)).toBe(source)
})

test("chunking covers every sample and leaves the remainder in the last chunk", () => {
  const source = syntheticTone({ seconds: 0.05, sample_rate: 48000 })
  const chunks = chunkPcm16(source, 1_000)
  expect(chunks.length).toBe(3)
  expect(chunks.map((c) => c.length)).toEqual([1_000, 1_000, 400])
  expect(chunks.reduce((total, c) => total + c.length, 0)).toBe(source.length)
  expect(() => chunkPcm16(source, 0)).toThrow(/at least one sample/)
})

test("base64 round-trips a buffer larger than one encoding chunk", () => {
  const source = syntheticTone({ seconds: 1, hz: 440, sample_rate: 48000, amplitude: 0.8 })
  expect(source.byteLength).toBeGreaterThan(0x8000)
  const restored = base64ToPcm16(pcm16ToBase64(source))
  expect(restored.length).toBe(source.length)
  expect(Array.from(restored.subarray(0, 64))).toEqual(Array.from(source.subarray(0, 64)))
  expect(peakLevel(restored)).toBeCloseTo(0.8, 2)
})

test("the synthetic tone has the requested length and level and is not silence", () => {
  const tone = syntheticTone({ seconds: 0.25, hz: 440, sample_rate: 24000, amplitude: 0.3 })
  expect(tone.length).toBe(6_000)
  expect(peakLevel(tone)).toBeCloseTo(0.3, 2)
  expect(peakLevel(new Int16Array(100))).toBe(0)
})
