// PCM helpers shared by the browser bridge and the local surface.
//
// Everything here works on 16-bit signed mono samples, the format the voice core exchanges. Audio
// stays in memory: nothing in this module writes a file.

import type { SampleRate } from "./voice-contract"

export const SAMPLE_RATES: readonly SampleRate[] = [16000, 24000, 48000]

export const isSampleRate = (value: unknown): value is SampleRate => SAMPLE_RATES.includes(value as SampleRate)

/** Clamped float (-1..1) to signed 16-bit. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i] as number))
    out[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff)
  }
  return out
}

export function pcm16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length)
  for (let i = 0; i < input.length; i++) out[i] = (input[i] as number) / 0x8000
  return out
}

/**
 * Linear resample. Speech between 16/24/48 kHz does not need a windowed filter, and a simple,
 * obviously correct interpolation beats a clever one that nobody can check.
 */
export function resamplePcm16(input: Int16Array, from: number, to: number): Int16Array {
  if (from === to || input.length === 0) return input
  const ratio = to / from
  const length = Math.max(1, Math.round(input.length * ratio))
  const out = new Int16Array(length)
  for (let i = 0; i < length; i++) {
    const position = i / ratio
    const left = Math.floor(position)
    const right = Math.min(input.length - 1, left + 1)
    const drift = position - left
    out[i] = Math.round((input[left] as number) * (1 - drift) + (input[right] as number) * drift)
  }
  return out
}

/** Split into fixed-size chunks; the last chunk keeps whatever is left. */
export function chunkPcm16(input: Int16Array, samplesPerChunk: number): Int16Array[] {
  if (samplesPerChunk <= 0) throw new Error("a chunk needs at least one sample")
  const chunks: Int16Array[] = []
  for (let at = 0; at < input.length; at += samplesPerChunk) chunks.push(input.subarray(at, Math.min(input.length, at + samplesPerChunk)))
  return chunks
}

/** Loudest sample as 0..1; used for evidence that audio is flowing, never for a transcript. */
export function peakLevel(input: Int16Array): number {
  let peak = 0
  for (let i = 0; i < input.length; i++) {
    const magnitude = Math.abs(input[i] as number)
    if (magnitude > peak) peak = magnitude
  }
  return peak / 0x8000
}

/** A tone, for proving the outbound path end to end without recording a person. */
export function syntheticTone(input: { seconds: number; hz?: number; sample_rate?: SampleRate; amplitude?: number }): Int16Array {
  const rate = input.sample_rate ?? 48000
  const hz = input.hz ?? 440
  const amplitude = Math.min(1, Math.max(0, input.amplitude ?? 0.3))
  const samples = Math.max(1, Math.round(input.seconds * rate))
  const out = new Int16Array(samples)
  for (let i = 0; i < samples; i++) out[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * amplitude * 0x7fff)
  return out
}

const CHUNK = 0x8000

/** Base64 for the protocol pipe. Chunked so a long buffer cannot blow the argument stack. */
export function pcm16ToBase64(input: Int16Array): string {
  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  let binary = ""
  for (let at = 0; at < bytes.length; at += CHUNK) binary += String.fromCharCode(...bytes.subarray(at, Math.min(bytes.length, at + CHUNK)))
  return btoa(binary)
}

export function base64ToPcm16(input: string): Int16Array {
  const binary = atob(input)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2))
}
